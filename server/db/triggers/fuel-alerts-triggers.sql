-- =============================================================================
-- TRIGGERS D'ALERTES POUR LA TABLE FUEL_RECORDS
-- Rejouable (IF NOT EXISTS, CREATE OR REPLACE, ON CONFLICT DO NOTHING), posé à chaque démarrage
-- par server/init-database.ts. Test : tests/integration/fuel-alerts-triggers.test.ts.
-- Règle : une alerte en échec ne casse jamais l'INSERT du plein (EXCEPTION puis WARNING).
-- =============================================================================

-- Destinataires des alertes générées en base, par type d'alerte : des rôles, jamais un user_id en dur.
-- La ligne par défaut reprend AlertService.fuelRecipients ; une valeur déjà réglée n'est pas écrasée.
CREATE TABLE IF NOT EXISTS alert_recipient_settings (
    alert_type text PRIMARY KEY,
    recipient_roles text[] NOT NULL,
    updated_at timestamp NOT NULL DEFAULT now()
);

INSERT INTO alert_recipient_settings (alert_type, recipient_roles)
VALUES ('fuel', ARRAY['admin', 'logistics'])
ON CONFLICT (alert_type) DO NOTHING;

-- Une alerte par destinataire configuré, hors préférence « in_app » coupée (P-12).
-- La clé de déduplication et l'index uq_alerts_user_dedupe empêchent tout doublon au rejeu.
CREATE OR REPLACE FUNCTION emit_configured_alert(
    p_type text,
    p_title text,
    p_message text,
    p_priority text,
    p_link text,
    p_dedupe_key text
) RETURNS integer AS $$
DECLARE
    inserted_ids integer[];
BEGIN
    WITH ins AS (
        INSERT INTO alerts (user_id, title, message, type, priority, link, is_read, topic, dedupe_key)
        SELECT u.id, p_title, p_message, p_type, p_priority, p_link, false, p_type, p_dedupe_key
        FROM users u
        JOIN alert_recipient_settings s ON s.alert_type = p_type AND u.role = ANY (s.recipient_roles)
        WHERE NOT EXISTS (
            SELECT 1 FROM notification_preferences np
            WHERE np.user_id = u.id AND np.topic = p_type AND np.in_app = false
        )
        ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
        RETURNING id
    )
    SELECT array_agg(id ORDER BY id) INTO inserted_ids FROM ins;

    -- Temps réel (couche 2) : notification livrée au commit seulement, relayée par
    -- server/lib/db-event-relay.ts en trames alert_created nominatives. Ids seuls : le relais
    -- relit les alertes, la charge reste loin de la limite de 8000 octets de pg_notify.
    IF inserted_ids IS NOT NULL THEN
        PERFORM pg_notify(
            'fleet_events',
            json_build_object(
                'source', 'database',
                'version', 1,
                'entity', 'alert',
                'eventType', 'alert_created',
                'payload', json_build_object('alertIds', to_json(inserted_ids)),
                'emittedAt', to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            )::text
        );
    END IF;
    RETURN COALESCE(array_length(inserted_ids, 1), 0);
END;
$$ LANGUAGE plpgsql;

-- TRIGGER CONSOMMATION CARBURANT ANORMALE
-- Consommation du plein (L/100 km depuis le plein précédent) comparée à la moyenne des intervalles
-- des 90 jours qui précèdent ce plein. La moyenne se calcule sur une sous-requête : un agrégat
-- ne peut pas contenir une fonction fenêtre (AVG(LAG() OVER) échouait au 2e plein).
CREATE OR REPLACE FUNCTION check_fuel_consumption() RETURNS TRIGGER AS $$
DECLARE
    previous_mileage integer;
    current_consumption numeric;
    avg_consumption numeric;
    excess_percent integer;
BEGIN
    -- Reprise d'historique (CDC #9) : SET LOCAL fleetos.suppress_side_effects = 'on' coupe cet effet.
    IF current_setting('fleetos.suppress_side_effects', true) = 'on' THEN RETURN NEW; END IF;
    IF NEW.vehicle_id IS NULL OR NEW.mileage IS NULL OR NEW.date IS NULL OR NEW.deleted_at IS NOT NULL THEN
        RETURN NEW;
    END IF;

    BEGIN
        SELECT fr.mileage INTO previous_mileage
        FROM fuel_records fr
        WHERE fr.vehicle_id = NEW.vehicle_id
          AND fr.deleted_at IS NULL
          AND fr.mileage IS NOT NULL
          AND (fr.date, fr.id) < (NEW.date, NEW.id)
        ORDER BY fr.date DESC, fr.id DESC
        LIMIT 1;

        IF previous_mileage IS NULL OR NEW.mileage <= previous_mileage THEN
            RETURN NEW;
        END IF;

        current_consumption := NEW.quantity::numeric / (NEW.mileage - previous_mileage) * 100;

        SELECT avg(intervals.consumption) INTO avg_consumption
        FROM (
            SELECT fr.quantity::numeric
                   / NULLIF(fr.mileage - lag(fr.mileage) OVER (ORDER BY fr.date, fr.id), 0) * 100 AS consumption
            FROM fuel_records fr
            WHERE fr.vehicle_id = NEW.vehicle_id
              AND fr.deleted_at IS NULL
              AND fr.mileage IS NOT NULL
              AND fr.date >= NEW.date - 90
              AND (fr.date, fr.id) < (NEW.date, NEW.id)
        ) AS intervals
        WHERE intervals.consumption > 0;

        IF avg_consumption > 0 AND current_consumption > avg_consumption * 1.2 THEN
            excess_percent := round((current_consumption - avg_consumption) / avg_consumption * 100);
            PERFORM emit_configured_alert(
                'fuel',
                'Consommation carburant élevée',
                format(
                    'Véhicule %s - Consommation +%s%% vs moyenne (%s L/100 km)',
                    (SELECT v.registration_number FROM vehicles v WHERE v.id = NEW.vehicle_id),
                    excess_percent,
                    round(current_consumption, 1)
                ),
                CASE WHEN excess_percent > 50 THEN 'high' ELSE 'medium' END,
                '/vehicles/' || NEW.vehicle_id,
                'fuel-consumption:' || NEW.id
            );
        END IF;
    -- WHEN OTHERS n'attrape pas query_canceled (57014, statement_timeout) : listé à part, sinon
    -- un délai dépassé pendant l'alerte annulerait l'INSERT du plein.
    EXCEPTION WHEN query_canceled OR OTHERS THEN
        RAISE WARNING 'check_fuel_consumption : alerte non créée pour le plein % (SQLSTATE %, %)', NEW.id, SQLSTATE, SQLERRM;
    END;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trigger_fuel_consumption
    AFTER INSERT
    ON fuel_records
    FOR EACH ROW
    EXECUTE FUNCTION check_fuel_consumption();

-- TRIGGER COÛT CARBURANT ÉLEVÉ
-- Total du mois du plein (pas du mois courant : une saisie rétroactive vise son propre mois).
CREATE OR REPLACE FUNCTION check_fuel_cost() RETURNS TRIGGER AS $$
DECLARE
    monthly_budget numeric := 500000; -- Budget mensuel par véhicule en F CFA
    month_start date;
    month_total numeric;
BEGIN
    IF current_setting('fleetos.suppress_side_effects', true) = 'on' THEN RETURN NEW; END IF;
    IF NEW.vehicle_id IS NULL OR NEW.date IS NULL OR NEW.deleted_at IS NOT NULL THEN
        RETURN NEW;
    END IF;

    BEGIN
        month_start := date_trunc('month', NEW.date)::date;

        SELECT COALESCE(sum(fr.cost), 0) INTO month_total
        FROM fuel_records fr
        WHERE fr.vehicle_id = NEW.vehicle_id
          AND fr.deleted_at IS NULL
          AND fr.date >= month_start
          AND fr.date < (month_start + INTERVAL '1 month')::date;

        IF month_total > monthly_budget THEN
            PERFORM emit_configured_alert(
                'fuel',
                'Budget carburant dépassé',
                format('Véhicule %s - Budget mensuel dépassé : %s F CFA / %s F CFA',
                    (SELECT v.registration_number FROM vehicles v WHERE v.id = NEW.vehicle_id),
                    round(month_total), round(monthly_budget)),
                'high',
                '/vehicles/' || NEW.vehicle_id,
                'fuel-budget:' || NEW.vehicle_id || ':' || to_char(month_start, 'YYYY-MM') || ':exceeded'
            );
        ELSIF month_total > monthly_budget * 0.8 THEN
            PERFORM emit_configured_alert(
                'fuel',
                'Budget carburant en approche',
                format('Véhicule %s - 80%% du budget mensuel atteint : %s F CFA / %s F CFA',
                    (SELECT v.registration_number FROM vehicles v WHERE v.id = NEW.vehicle_id),
                    round(month_total), round(monthly_budget)),
                'medium',
                '/vehicles/' || NEW.vehicle_id,
                'fuel-budget:' || NEW.vehicle_id || ':' || to_char(month_start, 'YYYY-MM') || ':80'
            );
        END IF;
    -- WHEN OTHERS n'attrape pas query_canceled (57014, statement_timeout) : listé à part, sinon
    -- un délai dépassé pendant l'alerte annulerait l'INSERT du plein.
    EXCEPTION WHEN query_canceled OR OTHERS THEN
        RAISE WARNING 'check_fuel_cost : alerte non créée pour le plein % (SQLSTATE %, %)', NEW.id, SQLSTATE, SQLERRM;
    END;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trigger_fuel_cost
    AFTER INSERT OR UPDATE OF cost
    ON fuel_records
    FOR EACH ROW
    EXECUTE FUNCTION check_fuel_cost();
