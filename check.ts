import * as fs from "fs";
import { fileURLToPath } from "url";
import { createHash } from "crypto";

const TOKEN_URL = "https://mobil.itmc.tu-dortmund.de/oauth2/v2/access_token";
const RESULTS_URL = "https://mobil.itmc.tu-dortmund.de/lsf/v3/courses";
const CERTIFICATE_URL =
  "https://irb.cs.tu-dortmund.de/cont/de/service/stud/zeugnisinfo/zeugnisinfo.sh";
const NTFY_BASE_URL = process.env.NTFY_BASE_URL ?? "https://ntfy.sh";
const STATE_FILE = fileURLToPath(new URL("./state.json", import.meta.url));
const USER_AGENT = process.env.USER_AGENT ?? "tu-ntfy/1.0 (https://github.com/phibr0/tu-ntfy)";

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

const fetchAccessToken = async (username: string, password: string): Promise<string> => {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify({ username, password, grant_type: "password" }),
  });
  if (!res.ok) throw new Error(`Token request failed: ${res.status}`);
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
};

const fetchResults = async (accessToken: string): Promise<CourseResult[]> => {
  const res = await fetch(RESULTS_URL, {
    headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": USER_AGENT },
  });
  if (!res.ok) throw new Error(`Results request failed: ${res.status}`);
  return (await res.json()) as CourseResult[];
};

const fetchCertificateStatus = async (matrikelnummer: string): Promise<string> => {
  const formData = new URLSearchParams();
  formData.append("matrikelnummer", matrikelnummer);

  const res = await fetch(CERTIFICATE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
    body: formData.toString(),
  });
  if (!res.ok) throw new Error(`Certificate request failed: ${res.status}`);

  const html = await res.text();
  const h2Match = html.match(/<h2[^>]*>(.*?)<\/h2>/gi);
  if (!h2Match || h2Match.length < 2) {
    return "Unable to parse certificate status";
  }

  const secondH2 = h2Match[1];
  const textMatch = secondH2.match(/<h2[^>]*>(.*?)<\/h2>/i);
  const text = textMatch
    ? textMatch[1].replace(/\s+/g, " ").trim()
    : "Unable to parse certificate status";

  return text;
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
const matrikelnummer = process.env.MATRIKELNUMMER!;

const state = readState();

const accessToken = await fetchAccessToken(username, password);
const results = await fetchResults(accessToken);

const nextState = structuredClone(state);
let updated = false;

for (const e of results) {
  const labID = hash(e.labID);

  const sig = hash([e.labID, e.aenddat, e.pstatusKurz, e.pstatus, e.pnote, e.pdatum].join("#"));
  if (nextState[labID] === sig) continue;

  const leistung = e.leistung || "(untitled)";
  const status = e.pstatus || e.pstatusKurz || "";
  const note = e.pnote === "000" ? null : `${e.pnote[0]}.${e.pnote.slice(1)}`;

  const parts = [`Course: ${leistung}`];
  if (note) parts.push(`Grade: ${note}`);
  if (status) parts.push(`Status: ${status}`);
  if (e.aenddat) parts.push(`Updated: ${e.aenddat}`);

  await notify(ntfyTopic, "Exam Result", parts.join(" | "));
  nextState[labID] = sig;
  updated = true;
}

if (matrikelnummer) {
  try {
    const status = await fetchCertificateStatus(matrikelnummer);
    const certificateHash = hash(`${matrikelnummer}-${status}`);
    const key = hash(`certificate-status-${matrikelnummer}`);
    const storedHash = state[key];

    if (certificateHash !== storedHash) {
      if (!status.includes("Zeugnis ist nicht abholbereit")) {
        await notify(ntfyTopic, "Certificate Available", status);
      }
      nextState[key] = certificateHash;
      updated = true;
    }
  } catch (error) {
    console.error("Failed to check certificate status:", error);
  }
}

if (updated || !fs.existsSync(STATE_FILE)) writeState(nextState);
