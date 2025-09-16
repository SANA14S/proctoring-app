import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { createObjectCsvStringifier } from 'csv-writer';
import { randomUUID } from 'crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

// In-memory store (for demo)
const sessions: Record<string, { createdAt: number; candidateName?: string; events: Array<{ time: string; type: string; detail?: string }> }> = {};

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// Create session
app.post('/api/session', (req, res) => {
  const id = randomUUID();
  const candidateName = typeof req.body?.candidateName === 'string' ? req.body.candidateName : undefined;
  sessions[id] = { createdAt: Date.now(), candidateName, events: [] };
  res.json({ sessionId: id });
});

// Append events
app.post('/api/session/:id/events', (req, res) => {
  const id = req.params.id;
  const body = req.body;
  if (!sessions[id]) return res.status(404).json({ error: 'Session not found' });
  const events = Array.isArray(body?.events) ? body.events : [];
  for (const e of events) {
    if (e && typeof e.time === 'string' && typeof e.type === 'string') {
      sessions[id].events.push({ time: e.time, type: e.type, detail: typeof e.detail === 'string' ? e.detail : undefined });
    }
  }
  res.json({ ok: true, count: events.length });
});

// CSV report
app.get('/api/session/:id/report.csv', (req, res) => {
  const id = req.params.id;
  const s = sessions[id];
  if (!s) return res.status(404).send('Session not found');
  const csv = createObjectCsvStringifier({ header: [ { id: 'time', title: 'time' }, { id: 'type', title: 'type' }, { id: 'detail', title: 'detail' } ] });
  const header = csv.getHeaderString();
  const records = csv.stringifyRecords(s.events.map((e) => ({ time: e.time, type: e.type, detail: e.detail ?? '' })));
  const content = header + records;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="report-${id}.csv"`);
  res.send(content);
});

function computeIntegrityScore(events: Array<{ time: string; type: string; detail?: string }>) {
  let score = 100;
  const counts: Record<string, number> = {};
  for (const e of events) {
    counts[e.type] = (counts[e.type] || 0) + 1;
  }
  score -= (counts['absence-10s'] || 0) * 10;
  score -= (counts['multiple-faces'] || 0) * 10;
  score -= (counts['object-detected'] || 0) * 5;
  score -= (counts['focus-away-5s'] || 0) * 5;
  if (score < 0) score = 0;
  return { score, counts };
}

// PDF report
app.get('/api/session/:id/report.pdf', async (req, res) => {
  const id = req.params.id;
  const s = sessions[id];
  if (!s) return res.status(404).send('Session not found');

  const { score, counts } = computeIntegrityScore(s.events);
  const durationMin = Math.max(0, Math.round((Date.now() - s.createdAt) / 60000));

  const pdf = await PDFDocument.create();
const page = pdf.addPage([595.28, 841.89]); // A4 portrait
const font = await pdf.embedFont(StandardFonts.Helvetica);

// 👇 Add sanitize function here
const sanitize = (text: string) =>
  text.replace(/≈/g, "~"); // or "approx."

// 👇 Update drawText to use sanitize
const drawText = (text: string, x: number, y: number, size = 12) => {
  page.drawText(sanitize(text), { x, y, size, font, color: rgb(0,0,0) });
};

let y = 800;
drawText("Proctoring Report", 50, y, 20); y -= 30;
drawText(`Session ID: ${id}`, 50, y); y -= 16;
drawText(`Candidate: ${s.candidateName || "N/A"}`, 50, y); y -= 16;
drawText(`Duration: ${durationMin} min`, 50, y); y -= 16;
drawText(`Integrity Score: ${score}/100`, 50, y); y -= 24;

// ... rest of your code stays same


  drawText('Summary', 50, y, 14); y -= 18;
  drawText(`Face-found events: ${(counts['face-found']||0)}`, 60, y); y -= 14;
  drawText(`Multiple faces: ${(counts['multiple-faces']||0)}`, 60, y); y -= 14;
  drawText(`Absence >10s: ${(counts['absence-10s']||0)}`, 60, y); y -= 14;
  drawText(`Focus away >5s: ${(counts['focus-away-5s']||0)}`, 60, y); y -= 14;
  drawText(`Objects detected: ${(counts['object-detected']||0)}`, 60, y); y -= 24;

  drawText('Event Log (time, type, detail)', 50, y, 14); y -= 18;
  const maxRows = 30;
  const events = s.events.slice(-maxRows);
  for (const e of events) {
    const line = `${e.time}  |  ${e.type}${e.detail ? '  |  ' + e.detail : ''}`;
    drawText(line.substring(0, 90), 60, y);
    y -= 14;
    if (y < 60) break;
  }

  const bytes = await pdf.save();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="report-${id}.pdf"`);
  res.send(Buffer.from(bytes));
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`API listening on port ${port}`);
});
