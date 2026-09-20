(() => {
  if (window !== window.top || document.getElementById("starfire-refresh-control")) return;

  const button = document.createElement("button");
  button.id = "starfire-refresh-control";
  button.type = "button";
  button.title = "Refresh this proxied page";
  button.setAttribute("aria-label", "Refresh this proxied page");
  button.textContent = "↻";

  Object.assign(button.style, {
    position: "fixed",
    top: "12px",
    right: "12px",
    width: "44px",
    height: "44px",
    zIndex: "2147483647",
    border: "1px solid rgba(255,255,255,.28)",
    borderRadius: "12px",
    background: "rgba(5,8,22,.88)",
    color: "#fff",
    font: "700 24px/1 system-ui,-apple-system,sans-serif",
    cursor: "pointer",
    boxShadow: "0 6px 24px rgba(0,0,0,.35)",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    touchAction: "manipulation"
  });

  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    location.reload();
  }, true);

  button.addEventListener("touchend", event => {
    event.preventDefault();
    event.stopPropagation();
    location.reload();
  }, { capture: true, passive: false });

  (document.body || document.documentElement).appendChild(button);
})();