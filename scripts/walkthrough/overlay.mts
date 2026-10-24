/**
 * What the walkthrough adds to the page while it records (D88), and nothing else: a caption at the foot of the
 * screen, a pointer that follows the mouse (recordings show none), a ring where it clicks, and full-screen cards for
 * the title and the end. It runs in the page, before the app, on every document.
 */
export function overlay() {
  const w = window as unknown as { __wt: Record<string, (...a: never[]) => void> };
  // The trip book prints itself on opening; the recording keeps it on screen instead.
  window.print = () => {};
  try {
    localStorage.setItem("dpg.tripPass", "1");
  } catch {
    /* the plan shows its outline only */
  }

  const css = `
    #wt-caption { position: fixed; left: 50%; bottom: 28px; transform: translate(-50%, 12px); z-index: 2147483646;
      max-width: min(1100px, calc(100vw - 64px)); padding: 16px 26px; border-radius: 18px; pointer-events: none;
      background: rgba(17, 24, 28, 0.88); color: #fff; font: 500 21px/1.45 Inter, system-ui, sans-serif;
      box-shadow: 0 10px 30px rgba(0,0,0,.25); opacity: 0; transition: opacity .45s, transform .45s; }
    #wt-caption.on { opacity: 1; transform: translate(-50%, 0); }
    #wt-caption b { display: block; font-weight: 700; font-size: 14px; letter-spacing: .08em; text-transform: uppercase;
      color: #7fd6cf; margin-bottom: 4px; }
    #wt-pointer { position: fixed; left: 0; top: 0; width: 26px; height: 26px; z-index: 2147483647; pointer-events: none;
      transform: translate(-100px, -100px); }
    #wt-ring { position: fixed; z-index: 2147483646; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%;
      border: 3px solid #0d9488; pointer-events: none; opacity: 0; }
    #wt-ring.go { animation: wt-ring .6s ease-out; }
    @keyframes wt-ring { from { opacity: .9; transform: scale(.4) } to { opacity: 0; transform: scale(1.4) } }
    #wt-card { position: fixed; inset: 0; z-index: 2147483645; display: grid; place-content: center; gap: 14px;
      text-align: center; background: #f6f8f8; color: #11181c; font-family: Inter, system-ui, sans-serif;
      opacity: 0; pointer-events: none; transition: opacity .6s; }
    #wt-card.on { opacity: 1; }
    #wt-card h1 { margin: 0; font-size: 56px; font-weight: 800; letter-spacing: -.02em; }
    #wt-card p { margin: 0; font-size: 26px; color: #4b5b60; }
  `;
  const pointer =
    '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 2l15 11-6.5 1.2L16 21l-3 1.3-3.4-6.9L4 20z" ' +
    'fill="#11181c" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';

  const mount = () => {
    if (document.getElementById("wt-caption")) return;
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    const el = (id: string, html = "") => {
      const d = document.createElement("div");
      d.id = id;
      d.innerHTML = html;
      document.body.append(d);
      return d;
    };
    const card = el("wt-card");
    const caption = el("wt-caption");
    const ring = el("wt-ring");
    const arrow = el("wt-pointer", pointer);
    let x = -100;
    let y = -100;
    const saved = sessionStorage.getItem("wt-at");
    if (saved) [x, y] = JSON.parse(saved) as [number, number];
    arrow.style.transform = `translate(${x}px, ${y}px)`;
    window.addEventListener(
      "mousemove",
      (e) => {
        arrow.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
        sessionStorage.setItem("wt-at", JSON.stringify([e.clientX, e.clientY]));
      },
      true,
    );
    window.addEventListener(
      "mousedown",
      (e) => {
        ring.style.left = `${e.clientX}px`;
        ring.style.top = `${e.clientY}px`;
        ring.classList.remove("go");
        void ring.offsetWidth;
        ring.classList.add("go");
      },
      true,
    );
    w.__wt = {
      caption: (title: string, text: string) => {
        caption.innerHTML = title || text ? `<b>${title}</b>${text}` : "";
        caption.classList.toggle("on", !!(title || text));
      },
      card: (title: string, text: string) => {
        card.innerHTML = title ? `<h1>${title}</h1><p>${text}</p>` : card.innerHTML;
        card.classList.toggle("on", !!title);
      },
    };
  };
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);
}
