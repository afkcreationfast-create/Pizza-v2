# MA-CANDAR V3 — Client + Admin + Chat

Cette version transforme le projet en application web avec :
- catalogue client dynamique
- produits/prix/descriptions gérés depuis Admin
- commandes enregistrées en base PostgreSQL
- espace `/admin` protégé par connexion
- gestion des produits
- gestion des commandes et statuts
- chat temps réel client ↔ admin avec Socket.IO
- WhatsApp pour confirmer la commande

## Déploiement Render

Cette V3 doit être déployée comme **Web Service**, pas Static Site.

1. Crée un dépôt GitHub avec tout le projet.
2. Sur Render : New → PostgreSQL.
3. Crée la base de données.
4. Crée ensuite New → Web Service.
5. Connecte le dépôt GitHub.
6. Build command : `npm install`
7. Start command : `npm start`
8. Ajoute les variables :
   - `DATABASE_URL` = Internal Database URL de ton PostgreSQL Render
   - `JWT_SECRET` = une longue chaîne secrète aléatoire
   - `ADMIN_EMAIL` = email de l'administrateur
   - `ADMIN_PASSWORD` = mot de passe initial de l'administrateur

Au premier démarrage, le serveur crée les tables et le compte admin si celui-ci n'existe pas.

## Chat

Le chat est temps réel avec Socket.IO. Pour un vrai déploiement multi-instance, il faudra ajouter un adaptateur Socket.IO compatible avec le scaling. Sur un seul Web Service Render, cette version convient.

## Important

Le fichier `public/admin/admin.js` contient une fonction de modification rapide volontairement simple. Pour une gestion complète (édition de tous les champs, upload de photos, catégories, horaires et plusieurs administrateurs), on peut l'étendre.

Le catalogue de démonstration est créé automatiquement si la table produits est vide.

Le numéro WhatsApp est dans `public/client.js` :
`50947354987`.
