(() => {
  const dialog = document.getElementById("feedbackDialog");
  const open = document.getElementById("feedbackOpen");
  const close = document.getElementById("feedbackClose");
  const form = document.getElementById("feedbackForm");
  const submit = document.getElementById("feedbackSubmit");
  const status = document.getElementById("feedbackStatus");
  if (!(dialog instanceof HTMLDialogElement) || !(open instanceof HTMLButtonElement) || !(form instanceof HTMLFormElement) || !(submit instanceof HTMLButtonElement) || !(status instanceof HTMLElement)) return;

  open.addEventListener("click", () => {
    status.textContent = "";
    dialog.showModal();
  });
  close?.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => {
    if (event.target === dialog) dialog.close();
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const formData = new FormData(form);
    const content = String(formData.get("content") || "").trim();
    status.textContent = "正在提交…";
    submit.disabled = true;
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: formData.get("category"),
          content,
          contact: String(formData.get("contact") || "").trim(),
          website: formData.get("website"),
        }),
      });
      if (!response.ok) throw new Error();
      form.reset();
      status.textContent = "";
      dialog.close();
      toast("提交成功，感谢反馈");
    } catch {
      status.textContent = "提交失败，请检查网络后重试。";
    } finally {
      submit.disabled = false;
    }
  });
})();
