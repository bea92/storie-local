# Mini Storie Local Linked

Mini sito locale per raccogliere storie e collegare le risposte tramite ID.

## Avvio

```bash
npm install
npm start
```

Poi apri:

```text
http://localhost:3000
```

## Dove vanno i dati

I dati vengono salvati nel file SQLite:

```text
storie.db
```

nella cartella del progetto.

## Export

JSON:

```text
http://localhost:3000/api/export
```

CSV:

```text
http://localhost:3000/api/export.csv
```

## Struttura dei collegamenti

- `stories.id` identifica ogni testo.
- `stories.parent_story_id` collega una frase/continuazione alla storia precedente.
- `assignments` salva quale storia è stata data a quale partecipante.
- `continuations` salva la risposta e collega:
  - `participant_story_id`: la storia scritta dal partecipante
  - `assigned_story_id`: la storia ricevuta da continuare
  - `continuation_story_id`: la frase aggiunta, salvata come nuovo nodo
