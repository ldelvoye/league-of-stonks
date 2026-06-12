// Entry point: wires user interactions to the data layer and the view. The
// heavy lifting lives in lib/ (data + logic) and ui/ (rendering), mirroring the
// backend's routes -> lib -> db layering.
import { getHistory, getScore, scoreErrorMessage } from "./lib/api.js";
import type { RiotId } from "./lib/types.js";
import { els } from "./ui/dom.js";
import {
  clearMessage,
  hidePlayer,
  isPlayerHidden,
  renderPlayer,
  revealWelcome,
  setRefreshBusy,
  showMessage,
  showWelcome,
} from "./ui/view.js";

// The player currently shown, so the refresh button knows what to reload.
let activePlayer: RiotId | null = null;

// ---------- Riot ID helpers ----------
function parseRiotId(raw: string): RiotId | null {
  const value = raw.trim();
  const hashIndex = value.indexOf("#");
  if (hashIndex === -1) return null;

  const gameName = value.slice(0, hashIndex).trim();
  const tagLine = value.slice(hashIndex + 1).trim();
  if (!gameName || !tagLine) return null;

  return { gameName, tagLine };
}

function playerHash(gameName: string, tagLine: string): string {
  return `#/player/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
}

// ---------- Flows ----------

// Feature 1: search. If the player exists in the DB, show their history without
// updating the score. Otherwise try to fetch their score (which creates them),
// then show the history. If the score lookup fails, the player is not found.
async function searchAndShow(gameName: string, tagLine: string): Promise<void> {
  activePlayer = { gameName, tagLine };
  showMessage(`Loading ${gameName}#${tagLine}\u2026`, "loading");

  const existing = await getHistory(gameName, tagLine);

  if (existing.ok && existing.data) {
    clearMessage();
    renderPlayer(existing.data);
    return;
  }

  if (existing.status !== 404) {
    showMessage(scoreErrorMessage(existing.status), "error");
    if (isPlayerHidden()) revealWelcome();
    return;
  }

  // Not in the DB yet: try to fetch and record their score.
  const scored = await getScore(gameName, tagLine);
  if (!scored.ok) {
    showMessage(scoreErrorMessage(scored.status), "error");
    revealWelcome();
    hidePlayer();
    return;
  }

  const created = await getHistory(gameName, tagLine);
  if (!created.ok || !created.data) {
    showMessage("Player not found.", "error");
    revealWelcome();
    hidePlayer();
    return;
  }

  clearMessage();
  renderPlayer(created.data);
}

// Feature 2: refresh. Fetch a fresh score, then re-display the updated history.
async function refreshActivePlayer(): Promise<void> {
  if (!activePlayer) return;

  const { gameName, tagLine } = activePlayer;
  setRefreshBusy(true);
  clearMessage();

  const scored = await getScore(gameName, tagLine);
  if (!scored.ok) {
    setRefreshBusy(false);
    showMessage(scoreErrorMessage(scored.status), "error");
    return;
  }

  const history = await getHistory(gameName, tagLine);
  setRefreshBusy(false);

  if (!history.ok || !history.data) {
    showMessage(scoreErrorMessage(history.status), "error");
    return;
  }

  clearMessage();
  renderPlayer(history.data);
}

// ---------- Routing ----------
function parseHash(): RiotId | null {
  const match = window.location.hash.match(/^#\/player\/([^/]+)\/([^/]+)\/?$/);
  if (!match) return null;
  try {
    return {
      gameName: decodeURIComponent(match[1]),
      tagLine: decodeURIComponent(match[2]),
    };
  } catch {
    return null;
  }
}

function router(): void {
  const route = parseHash();
  if (route) {
    els.searchInput.value = `${route.gameName}#${route.tagLine}`;
    void searchAndShow(route.gameName, route.tagLine);
  } else {
    activePlayer = null;
    showWelcome();
  }
}

// ---------- Events ----------
els.searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const parsed = parseRiotId(els.searchInput.value);
  if (!parsed) {
    showMessage("Enter a Riot ID like Faker#KR1 (GameName#TagLine).", "error");
    return;
  }

  const targetHash = playerHash(parsed.gameName, parsed.tagLine);
  if (window.location.hash === targetHash) {
    // Same player already routed; trigger a fresh search manually.
    void searchAndShow(parsed.gameName, parsed.tagLine);
  } else {
    window.location.hash = targetHash;
  }
});

els.refreshButton.addEventListener("click", () => void refreshActivePlayer());

window.addEventListener("hashchange", router);
window.addEventListener("DOMContentLoaded", router);

if (document.readyState !== "loading") {
  router();
}
