/**
 * Click-to-reveal for ```secret blocks.
 *
 * The rendered card carries the envelope in `data-secret`. Clicking the 🔒
 * button opens an inline key prompt; the key is fed to WebCrypto right here
 * in the browser and never leaves it. Only when `crypto.subtle` is missing
 * (plain-http LAN address — not a secure context) does the client fall back
 * to `POST /api/secrets/reveal`. Plain DOM, like the file viewer, so the
 * public share view gets it too.
 */
import { parseSecretEnvelope, unsealSecret, type SecretEnvelope } from "../../../src/lib/secret.js";
import { copyText } from "./clipboard.js";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function toast(message: string, kind: "info" | "error" = "info"): void {
  window.dispatchEvent(new CustomEvent("wikikai-toast", { detail: { message, kind } }));
}

async function decrypt(env: SecretEnvelope, key: string): Promise<string> {
  if (globalThis.crypto?.subtle) return unsealSecret(env, key);
  const res = await fetch("/api/secrets/reveal", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ envelope: env, key }),
  });
  const body = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!res.ok || typeof body.text !== "string") {
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return body.text;
}

function closePanel(card: HTMLElement): void {
  card.querySelector(".secret-panel")?.remove();
  card.classList.remove("open", "revealed");
}

function openPrompt(card: HTMLElement, env: SecretEnvelope): void {
  closePanel(card);
  card.classList.add("open");
  const panel = el("div", "secret-panel");
  const form = el("form", "secret-form");
  const input = el("input", "secret-key");
  input.type = "password";
  input.placeholder = "Decryption key";
  input.autocomplete = "off";
  input.setAttribute("aria-label", "Decryption key");
  const submit = el("button", "secret-reveal", "Reveal");
  submit.type = "submit";
  const cancel = el("button", "secret-cancel", "×");
  cancel.type = "button";
  cancel.setAttribute("aria-label", "close");
  form.append(input, submit, cancel);
  panel.appendChild(form);
  if (env.hint) panel.appendChild(el("div", "secret-hint", `hint: ${env.hint}`));
  const error = el("div", "secret-error");
  error.hidden = true;
  panel.appendChild(error);
  card.appendChild(panel);

  cancel.addEventListener("click", () => closePanel(card));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePanel(card);
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const key = input.value;
    if (!key) {
      input.focus();
      return;
    }
    error.hidden = true;
    submit.disabled = true;
    submit.textContent = "Decrypting…";
    try {
      const text = await decrypt(env, key);
      showResult(card, env, text);
    } catch (err) {
      error.textContent = /wrong key|tampered/i.test((err as Error).message)
        ? "Wrong key"
        : (err as Error).message;
      error.hidden = false;
      submit.disabled = false;
      submit.textContent = "Reveal";
      input.select();
    }
  });
  input.focus();
}

function showResult(card: HTMLElement, env: SecretEnvelope, text: string): void {
  closePanel(card);
  card.classList.add("open", "revealed");
  const panel = el("div", "secret-panel");
  const pre = el("pre", "secret-text");
  pre.appendChild(el("code", undefined, text));
  const actions = el("div", "secret-actions");
  const copy = el("button", "secret-copy", "Copy");
  copy.type = "button";
  const hide = el("button", "secret-hide", "Hide");
  hide.type = "button";
  actions.append(copy, hide);
  panel.append(pre, actions);
  card.appendChild(panel);
  copy.addEventListener("click", async () => {
    const ok = await copyText(text);
    toast(ok ? `Copied ${env.label ?? "secret"}` : "Copy failed", ok ? "info" : "error");
  });
  hide.addEventListener("click", () => closePanel(card));
}

/** Wire every 🔒 button under `root`. Returns a cleanup that unbinds the
 *  listener and drops any revealed text still on screen. */
export function attachSecretBlocks(root: HTMLElement): () => void {
  const handler = (e: MouseEvent): void => {
    const target = e.target as HTMLElement | null;
    const btn = target?.closest<HTMLElement>(".secret-btn");
    if (!btn || !root.contains(btn)) return;
    const card = btn.closest<HTMLElement>(".secret-card");
    if (!card) return;
    e.preventDefault();
    e.stopPropagation();
    if (card.classList.contains("open")) {
      closePanel(card);
      return;
    }
    let env: SecretEnvelope;
    try {
      env = parseSecretEnvelope(card.getAttribute("data-secret") ?? "");
    } catch (err) {
      toast(`Secret block is malformed: ${(err as Error).message}`, "error");
      return;
    }
    openPrompt(card, env);
  };
  root.addEventListener("click", handler);
  return () => {
    root.removeEventListener("click", handler);
    for (const card of root.querySelectorAll<HTMLElement>(".secret-card.open")) closePanel(card);
  };
}
