export function bindPanel(form, state, handlers) {
  const labels = form.querySelectorAll("[data-for]");
  const btnSim = form.querySelector("#btn-sim");

  function syncSimButton() {
    btnSim.textContent = state.simPaused ? "继续时间 P" : "暂停时间 P";
    btnSim.classList.toggle("primary", state.simPaused);
  }

  function refresh() {
    form.orbitSpeed.value = String(state.orbitSpeed);
    form.spinSpeed.value = String(state.spinSpeed);
    form.earthTilt.value = String(state.earthTilt);
    form.showOrbits.checked = state.showOrbits;
    form.showLabels.checked = state.showLabels;
    syncSimButton();
    for (const el of labels) {
      const key = el.getAttribute("data-for");
      const v = state[key];
      el.textContent = typeof v === "number" && v % 1 !== 0 ? v.toFixed(2) : String(v);
    }
    handlers.onChange();
  }

  form.addEventListener("input", () => {
    state.orbitSpeed = Number(form.orbitSpeed.value);
    state.spinSpeed = Number(form.spinSpeed.value);
    state.earthTilt = Number(form.earthTilt.value);
    state.showOrbits = form.showOrbits.checked;
    state.showLabels = form.showLabels.checked;
    refresh();
  });

  form.querySelector("#btn-tour").addEventListener("click", handlers.resumeTour);
  form.querySelector("#btn-pause").addEventListener("click", handlers.toggleTour);
  form.querySelector("#btn-proj").addEventListener("click", handlers.toggleProjection);
  form.querySelector("#btn-solar").addEventListener("click", handlers.solarEclipse);
  form.querySelector("#btn-lunar").addEventListener("click", handlers.lunarEclipse);
  btnSim.addEventListener("click", () => {
    state.simPaused = !state.simPaused;
    syncSimButton();
    handlers.onChange();
  });

  refresh();
  return { refresh, syncSimButton };
}
