import * as fs from "fs";
import { fileURLToPath } from "url";
import { createHash } from "crypto";

const TOKEN_URL = "https://mobil.itmc.tu-dortmund.de/oauth2/v2/access_token";
const RESULTS_URL = "https://mobil.itmc.tu-dortmund.de/lsf/v3/courses";
const NTFY_BASE_URL = "https://ntfy.sh";
const STATE_FILE = fileURLToPath(new URL("./state.json", import.meta.url));

type State = Record<string, string>;

interface CourseResult {
  labID: string;
  leistung: string;
  pstatusKurz: string;
  pstatus: string;
  pnote: string;
  pdatum: string;
  aenddat: string;
}

const hash = (value: string): string => createHash("sha256").update(value).digest("hex");

const readState = (): State => {
  if (!fs.existsSync(STATE_FILE)) return {};
  const raw = fs.readFileSync(STATE_FILE, "utf-8").trim();
  if (raw.length === 0) return {};
  return JSON.parse(raw) as State;
};

const writeState = (state: State) => {
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
};

const fmtGrade = (pnote: string): string => {
  if (pnote === "000" || pnote.trim() === "") return pnote;
  if (/^\d{3}$/.test(pnote)) return `${pnote[0]}.${pnote.slice(1)}`;
  return pnote;
};

const signature = (e: CourseResult): string => {
  return hash([e.labID, e.aenddat, e.pstatusKurz, e.pstatus, e.pnote, e.pdatum].join("#"));
};

const formatLine = (e: CourseResult): string => {
  const leistung = e.leistung || "(ohne Titel)";
  const status = e.pstatus || e.pstatusKurz || "";
  const note = fmtGrade(e.pnote);
  const date = e.aenddat ? ` (Änderung: ${e.aenddat})` : "";
  const notePart = note ? `, Note: ${note}` : "";
  const statusPart = status ? `, Status: ${status}` : "";
  return `- ${leistung}${notePart}${statusPart}${date}`;
};

const fetchAccessToken = async (username: string, password: string): Promise<string> => {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, grant_type: "password" }),
  });
  if (!res.ok) throw new Error(`Token request failed: ${res.status}`);
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
};

const fetchResults = async (accessToken: string): Promise<CourseResult[]> => {
  const res = await fetch(RESULTS_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Results request failed: ${res.status}`);
  return (await res.json()) as CourseResult[];
};

const notify = async (topic: string, title: string, message: string): Promise<void> => {
  const url = `${NTFY_BASE_URL}/${encodeURIComponent(topic)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Title: title, Priority: "4" },
    body: message,
  });
  if (!res.ok) throw new Error(`Ntfy request failed: ${res.status}`);
};

const username = process.env.UNI_USERNAME!;
const password = process.env.UNI_PASSWORD!;
const ntfyTopic = process.env.NTFY_TOPIC!;

const state = readState();

const accessToken = await fetchAccessToken(username, password);
const results = await fetchResults(accessToken);

const changed: CourseResult[] = [];
const nextState: State = { ...state };

for (const e of results) {
  const labID = hash(e.labID);
  if (labID.length === 0) continue;

  const sig = signature(e);
  if (nextState[labID] !== sig) {
    changed.push(e);
    nextState[labID] = sig;
  }
}

if (changed.length === 0) {
  if (!fs.existsSync(STATE_FILE)) writeState(nextState);
} else {
  const body =
    `Neue/aktualisierte Einträge: ${changed.length}\n\n` + changed.map(formatLine).join("\n");

  await notify(ntfyTopic, "TU Dortmund: neue Prüfungsergebnisse", body);
  writeState(nextState);
}
