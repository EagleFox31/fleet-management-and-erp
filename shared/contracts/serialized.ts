/**
 * Forme d'un type après passage par JSON (`res.json` côté serveur, `response.json()` côté
 * client) : chaque `Date` arrive en texte ISO. Les types du serveur décrivent l'objet avant
 * envoi ; le client lit `Serialized<...>`.
 */
export type Serialized<T> = T extends Date
  ? string
  : T extends readonly (infer Item)[]
    ? Serialized<Item>[]
    : T extends object
      ? { [Key in keyof T]: Serialized<T[Key]> }
      : T;
