# Mini Storie Render

## Avvio locale

```bash
npm install
npm start
```

Poi apri:

```text
http://localhost:3000
```

## Export

JSON:

```text
/api/export
```

CSV:

```text
/api/export.csv
```

## Note

- Il codice foto viene salvato in `photo_code`.
- Ogni nuova storia viene collegata all'ultima storia inserita tramite `parent_story_id`.
- Gli export includono le connessioni tra storie.
