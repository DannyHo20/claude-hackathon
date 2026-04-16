# Mosaic

AI-facilitated small-group discussions for classrooms.

Students join a room, answer weekly questions, and get grouped by Claude based on answer similarity. Groups then work through a Claude-generated discussion agenda in timed steps. A shared "wall" collects final takeaways.

## Stack

- **Backend**: Express + Socket.io + SQLite (`better-sqlite3`)
- **Frontend**: React (Vite)
- **AI**: Claude Sonnet via Anthropic SDK

## Run

```bash
cp .env.example .env  # add ANTHROPIC_API_KEY
npm run seed
npm run dev
```

## Views

| Route | Who |
|---|---|
| `/` | Student join |
| `/professor` | Manage rooms & questions |
| `/projector` | Classroom display |
| `/admin` | Debug / force-advance steps |
