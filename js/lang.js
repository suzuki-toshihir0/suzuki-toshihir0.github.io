// 言語の切り替えボタン。最初の言語は index.html の head の中で先に決めている（表示がちらつかないように）
const btns = document.querySelectorAll(".langsw button");
const set = (l) => {
  document.documentElement.lang = l;
  btns.forEach((b) => b.setAttribute("aria-pressed", b.dataset.l === l ? "true" : "false"));
  try { localStorage.setItem("lang", l); } catch (e) {}
};
set(document.documentElement.lang);
btns.forEach((b) => b.addEventListener("click", () => set(b.dataset.l)));
