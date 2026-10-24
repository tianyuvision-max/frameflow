const homePage = $("homePage");
const editorPage = $("editorPage");
const uploadCard = $("upload");

function showFrameflowPage(page, { updateHistory = false, replaceHistory = false } = {}) {
  const nextPage = page === "editor" && frames.length ? "editor" : "home";
  const returningHome = nextPage === "home" && !editorPage.hidden;
  const mount = $(nextPage === "editor" ? "editorUploadMount" : "homeUploadMount");
  if (uploadCard.parentElement !== mount) mount.append(uploadCard);
  homePage.hidden = nextPage !== "home";
  editorPage.hidden = nextPage !== "editor";
  document.body.classList.toggle("editor-mode", nextPage === "editor");

  if (updateHistory) {
    const hash = nextPage === "editor" ? "#editor" : "#home";
    if (replaceHistory) history.replaceState(null, "", hash);
    else if (location.hash !== hash) history.pushState(null, "", hash);
  }
  if (nextPage === "editor") window.scrollTo({ top: 0, behavior: "smooth" });
  else if (returningHome) window.ffRefreshStats?.();
}

document.querySelector(".brand").addEventListener("click", event => {
  event.preventDefault();
  showFrameflowPage("home", { updateHistory: true });
});
window.addEventListener("hashchange", () => {
  showFrameflowPage(location.hash === "#editor" ? "editor" : "home");
});
window.addEventListener("popstate", () => {
  showFrameflowPage(location.hash === "#editor" ? "editor" : "home");
});

showFrameflowPage(location.hash === "#editor" ? "editor" : "home", {
  updateHistory: true,
  replaceHistory: true
});
setStatus("请先导入 PNG 序列帧");
scheduleFFmpegWarmup();
