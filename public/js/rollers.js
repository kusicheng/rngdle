import { revealRoll } from "./reveal.js?v=multi-roll-1";

const laneOrder = {
  1: ["center"],
  2: ["left", "center"],
  3: ["left", "center", "right"],
};
const numberPhases = new Set(["spinning", "digits", "pause"]);

function sessionKey(state) {
  return `${state?.user?.id ?? "guest"}:${state?.csrf ?? ""}`;
}

function prefersReducedMotion() {
  return (
    localStorage.getItem("rngdle_motion") === "reduced" ||
    matchMedia("(prefers-reduced-motion:reduce)").matches
  );
}

/** Each panel owns its requests and reveal; state updates never repaint peers. */
export function createRollers({
  host,
  getState,
  renderPanel,
  request,
  onState = () => {},
  onAction = () => {},
  onError = () => {},
  count = 1,
  canRoll = ({ primary, state }) => !state.user || (primary && !state.today),
  requestData = ({ id }) => ({ roller: id }),
}) {
  const lanes = new Map();
  let disposed = false;
  let mounted = false;
  let requestSequence = 0;
  let acceptedSequence = 0;

  function isCurrent(lane, generation) {
    return (
      !disposed &&
      lanes.get(lane.id) === lane &&
      lane.generation === generation &&
      host.contains(lane.root)
    );
  }

  function panelContext(lane) {
    return {
      id: lane.id,
      primary: lane.id === "center",
      roll: lane.roll,
      state: getState(),
      requesting: lane.requesting,
    };
  }

  function paint(lane) {
    lane.root.innerHTML = renderPanel(panelContext(lane));
    lane.root.classList.toggle("has-roll", Boolean(lane.roll));
    lane.root.setAttribute("aria-busy", "false");
  }

  function makeLane(id) {
    const root = host.ownerDocument.createElement("section");
    root.className = "roller-panel";
    root.dataset.roller = id;
    root.setAttribute(
      "aria-label",
      id === "center"
        ? "Main roller"
        : `${id === "left" ? "Left" : "Right"} roller`,
    );
    const lane = {
      id,
      root,
      roll:
        id === "center" ? getState().today : getState().rollers?.[id] || null,
      requesting: false,
      controller: null,
      generation: 0,
      pendingTimer: null,
    };
    paint(lane);
    return lane;
  }

  function cancelPresentation(lane) {
    lane.controller?.abort();
    lane.controller = null;
    if (lane.pendingTimer != null) {
      clearInterval(lane.pendingTimer);
      lane.pendingTimer = null;
    }
  }

  function retire(lane) {
    lane.generation++;
    cancelPresentation(lane);
    lane.requesting = false;
  }

  function setCount(value) {
    if (disposed) return count;
    const desiredCount = Math.max(1, Math.min(3, Number(value) || 1));
    count = Math.round(desiredCount);
    const ids = laneOrder[count];
    for (const [id, lane] of lanes) {
      if (ids.includes(id)) continue;
      retire(lane);
      lane.root.remove();
      lanes.delete(id);
    }
    for (const id of ids) {
      if (!lanes.has(id)) lanes.set(id, makeLane(id));
    }
    // Insert only the new or misplaced panel so the center keeps focus and reels.
    ids.forEach((id, index) => {
      const root = lanes.get(id).root;
      if (host.children[index] !== root)
        host.insertBefore(root, host.children[index] || null);
    });
    host.dataset.rollerCount = String(count);
    return count;
  }

  function mount() {
    if (disposed || mounted) return;
    mounted = true;
    host.replaceChildren();
    setCount(count);
  }

  function numberBusy(lane) {
    return (
      lane.requesting ||
      numberPhases.has(
        lane.root.querySelector(".roll-card")?.dataset.revealPhase,
      )
    );
  }

  function markRequesting(lane) {
    lane.root.setAttribute("aria-busy", "true");
    lane.root.classList.add("is-requesting");
    lane.root
      .querySelectorAll('[data-action="roll"], [data-action="replay"]')
      .forEach((button) => {
        button.disabled = true;
        if (button.dataset.action === "roll") button.textContent = "Rolling…";
      });
    if (prefersReducedMotion()) return;
    lane.root.querySelector(".roll-number")?.classList.add("number-unrevealed");
    lane.pendingTimer = setInterval(() => {
      const number = lane.root.querySelector(".unknown-number");
      if (number)
        number.textContent = String(
          Math.floor(Math.random() * 1000000),
        ).padStart(6, "0");
    }, 60);
  }

  function acceptState(state, context, sequence) {
    if (!state || sessionKey(getState()) !== context.session) return;
    // Guest replacements use increasing IDs. A slower, older response must not
    // replace a newer canonical result even though both panels keep their rolls.
    const newestId = (snapshot) =>
      Math.max(
        Number(snapshot.today?.id) || 0,
        ...Object.values(snapshot.rollers || {}).map(
          (roll) => Number(roll?.id) || 0,
        ),
      );
    const previousId = newestId(getState());
    const nextId = newestId(state);
    if (nextId < previousId) return;
    if (nextId === previousId && sequence < acceptedSequence) return;
    acceptedSequence = sequence;
    onState(state, { laneId: context.id, sequence });
  }

  async function present(lane, generation) {
    if (!isCurrent(lane, generation) || !lane.roll) return;
    const controller = new AbortController();
    lane.controller = controller;
    try {
      await revealRoll(lane.root, lane.roll, {
        signal: controller.signal,
        reducedMotion: prefersReducedMotion(),
      });
    } finally {
      if (lane.controller === controller) lane.controller = null;
    }
  }

  async function generate(lane) {
    if (disposed || numberBusy(lane) || !canRoll(panelContext(lane))) return;
    cancelPresentation(lane);
    const generation = ++lane.generation;
    const context = { ...panelContext(lane), session: sessionKey(getState()) };
    const sequence = ++requestSequence;
    lane.requesting = true;
    markRequesting(lane);
    try {
      const result = await request("roll", requestData(context));
      const state = result.state || (await request("state"));
      const sameSession = sessionKey(getState()) === context.session;
      acceptState(state, context, sequence);
      if (!sameSession || !isCurrent(lane, generation)) return;
      lane.roll = result.roll || state.today;
      lane.requesting = false;
      cancelPresentation(lane);
      lane.root.classList.remove("is-requesting");
      paint(lane);
      if (!result.alreadyRolled) await present(lane, generation);
    } catch (error) {
      if (
        !isCurrent(lane, generation) ||
        sessionKey(getState()) !== context.session
      )
        return;
      lane.requesting = false;
      cancelPresentation(lane);
      lane.root.classList.remove("is-requesting");
      paint(lane);
      onError(error);
    } finally {
      if (isCurrent(lane, generation)) {
        lane.requesting = false;
        if (lane.pendingTimer != null) {
          clearInterval(lane.pendingTimer);
          lane.pendingTimer = null;
        }
      }
    }
  }

  async function replay(lane) {
    if (disposed || numberBusy(lane) || !lane.roll) return;
    cancelPresentation(lane);
    const generation = ++lane.generation;
    try {
      await present(lane, generation);
    } catch (error) {
      if (isCurrent(lane, generation)) onError(error);
    }
  }

  function findLane(target) {
    const root = target?.closest?.("[data-roller]");
    const lane = lanes.get(root?.dataset.roller);
    return lane?.root === root && host.contains(root) ? lane : null;
  }

  function handleAction(name, target) {
    const lane = findLane(target);
    if (!lane || disposed) return false;
    if (name === "roll") {
      void generate(lane);
      return true;
    }
    if (name === "replay") {
      void replay(lane);
      return true;
    }
    if (["share", "breakdown"].includes(name)) {
      const roll = lane.roll;
      if (roll)
        Promise.resolve()
          .then(() => onAction(name, roll, lane.id))
          .catch(onError);
      return true;
    }
    return false;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const lane of lanes.values()) retire(lane);
  }

  return {
    mount,
    setCount,
    dispose,
    handleAction,
    isBusy: () =>
      [...lanes.values()].some((lane) => lane.requesting || lane.controller),
    activeRoll: (target) => findLane(target)?.roll || null,
    laneId: (target) => findLane(target)?.id || null,
  };
}
