// This presents an already saved roll. The server's number and EP never change.
const format = (value) => Number(value).toLocaleString("en-US");
const ROW_HEIGHT = 1.15;
const easeOut = (progress) => 1 - (1 - progress) ** 3;
const easeInOut = (progress) =>
  progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;

function makeReel(kind, document) {
  const element = document.createElement("span");
  element.className = `${kind}-reel`;
  element.setAttribute("aria-hidden", "true");
  const track = document.createElement("span");
  track.className = `${kind}-reel-track`;
  // The repeated cycle lets a reel wrap without showing an empty row.
  for (let index = 0; index <= 20; index++) {
    const digit = document.createElement("span");
    digit.className = `${kind}-reel-digit`;
    digit.textContent = String(index % 10);
    track.append(digit);
  }
  element.append(track);
  return { element, track, position: 0, spinning: true };
}

function positionReel(reel, position) {
  reel.position = position;
  const row = ((position % 10) + 10) % 10;
  reel.track.style.transform = `translateY(${-row * ROW_HEIGHT}em)`;
}

/** Resolve false when navigation or a rerender cancels the presentation. */
export async function revealRoll(
  root,
  roll,
  { signal, reducedMotion = false } = {},
) {
  const card = root.querySelector(".roll-card:not(.compact)");
  const number = card?.querySelector(".roll-number");
  const badgeList = card?.querySelector(".badge-list");
  const epPill = card?.querySelector(".ep-pill");
  if (!card || !number || !epPill || signal?.aborted) return false;

  const document = card.ownerDocument;
  const window = document.defaultView;
  card.querySelector(".reveal-status")?.remove();
  const finalNumber = String(roll.value);
  const finalEP = Math.max(0, Math.round(Number(roll.ep) || 0));
  let epNumber = epPill.querySelector(".ep-number");
  if (!epNumber) {
    epNumber = document.createElement("span");
    epNumber.className = "ep-number";
    epNumber.dataset.testid = "roll-ep";
    epPill.replaceChildren(epNumber, document.createTextNode(" EP"));
  }

  const nodes = [...(badgeList?.querySelectorAll(".badge-chip") || [])];
  const byId = new Map(nodes.map((node) => [node.dataset.badge, node]));
  const badges = (roll.badges || [])
    .map((badge, index) => ({
      badge,
      index,
      node: byId.get(String(badge.id)) || nodes[index],
    }))
    .filter(({ node }) => node)
    .sort(
      (left, right) =>
        Number(left.badge.ep) - Number(right.badge.ep) ||
        left.index - right.index,
    );
  const initialTabIndexes = new Map();
  const initialDisabled = new Map();
  for (const { badge, node } of badges) {
    initialTabIndexes.set(node, node.getAttribute("tabindex"));
    initialDisabled.set(node, node.disabled);
    node.dataset.ep = String(badge.ep);
    node.dataset.scoring = String(badge.isScoring !== false);
    badgeList.append(node);
  }

  let cancelled = false;
  let finished = false;
  let numberFrame = 0;
  const jobs = new Set();
  const current = () =>
    !cancelled && !signal?.aborted && card.isConnected && root.contains(card);
  const stop = () => {
    cancelled = true;
    window.cancelAnimationFrame(numberFrame);
    for (const cancel of [...jobs]) cancel();
  };
  signal?.addEventListener("abort", stop, { once: true });

  function wait(milliseconds) {
    return new Promise((resolve) => {
      if (!current()) return resolve(false);
      const cancel = () => {
        window.clearTimeout(timer);
        jobs.delete(cancel);
        resolve(false);
      };
      const timer = window.setTimeout(() => {
        jobs.delete(cancel);
        resolve(current());
      }, milliseconds);
      jobs.add(cancel);
    });
  }

  function tween(milliseconds, paint) {
    return new Promise((resolve) => {
      if (!current()) return resolve(false);
      let frame = 0;
      const start = window.performance.now();
      const cancel = () => {
        window.cancelAnimationFrame(frame);
        jobs.delete(cancel);
        resolve(false);
      };
      const tick = (now) => {
        if (!current()) {
          stop();
          return;
        }
        // A frame timestamp can precede this tween's start by a few milliseconds.
        const progress = Math.min(1, Math.max(0, (now - start) / milliseconds));
        paint(progress);
        if (progress < 1) frame = window.requestAnimationFrame(tick);
        else {
          jobs.delete(cancel);
          resolve(true);
        }
      };
      jobs.add(cancel);
      paint(0);
      frame = window.requestAnimationFrame(tick);
    });
  }

  function enableBadge(node) {
    node.classList.remove("badge-pending", "badge-enter");
    node.disabled = initialDisabled.get(node);
    const tabIndex = initialTabIndexes.get(node);
    if (tabIndex == null) node.removeAttribute("tabindex");
    else node.setAttribute("tabindex", tabIndex);
  }

  const status = document.createElement("span");
  status.className = "reveal-status sr-only";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");

  function restoreFinal() {
    // These references belong to this card, so an old reveal cannot affect a
    // newly rendered page even if its nodes use the same classes and IDs.
    number.classList.remove("number-reels", "number-pop");
    number.removeAttribute("aria-label");
    number.removeAttribute("role");
    number.textContent = finalNumber;
    epNumber.classList.remove("ep-reels");
    epNumber.removeAttribute("aria-hidden");
    epNumber.textContent = format(finalEP);
    epNumber.dataset.value = String(finalEP);
    for (const { node } of badges) {
      enableBadge(node);
      node.dataset.revealed = "true";
    }
    card.classList.remove("is-revealing");
    epPill.classList.remove("ep-counting");
    card.setAttribute("aria-busy", "false");
    card.dataset.revealPhase = finished ? "complete" : "cancelled";
    if (finished) {
      status.textContent = `Your roll is ${finalNumber}. ${badges.length} badges earned. ${format(finalEP)} EP.`;
    } else status.remove();
  }

  try {
    if (reducedMotion) {
      finished = true;
      card.append(status);
      return true;
    }
    if (!current()) return false;

    card.classList.add("is-revealing");
    card.setAttribute("aria-busy", "true");
    card.dataset.revealPhase = "spinning";
    card.append(status);
    for (const { node } of badges) {
      node.classList.add("badge-pending");
      node.dataset.revealed = "false";
      node.disabled = true;
      node.setAttribute("tabindex", "-1");
    }

    number.textContent = "";
    number.classList.add("number-reels");
    number.setAttribute("role", "img");
    number.setAttribute("aria-label", "Rolling your number");
    const digits = [...finalNumber].map((digit, index) => {
      const reel = makeReel("number", document);
      reel.element.dataset.final = digit;
      reel.element.dataset.settled = "false";
      positionReel(reel, index * 1.7);
      number.append(reel.element);
      return reel;
    });

    epNumber.textContent = "";
    epNumber.classList.add("ep-reels");
    epNumber.setAttribute("aria-hidden", "true");
    const width = String(finalEP).length;
    const epDigits = Array.from({ length: width }, (_, index) => {
      let separator = null;
      if (index > 0 && (width - index) % 3 === 0) {
        separator = document.createElement("span");
        separator.className = "ep-separator";
        separator.textContent = ",";
        epNumber.append(separator);
      }
      const reel = makeReel("ep", document);
      epNumber.append(reel.element);
      return { ...reel, separator, place: 10 ** (width - index - 1) };
    });
    function showEP(value) {
      const whole = Math.max(0, Math.min(finalEP, Math.floor(value)));
      const visibleWidth = String(whole).length;
      epNumber.dataset.value = String(whole);
      epDigits.forEach((reel, index) => {
        const visible = index >= width - visibleWidth;
        reel.element.style.display = visible ? "" : "none";
        if (reel.separator)
          reel.separator.style.display =
            visible && index > width - visibleWidth ? "" : "none";
        // Higher places turn only while the lower places carry. This also
        // leaves every drum exactly on a digit at each badge's integer total.
        const rotations = Math.floor(value / reel.place);
        const carry = Math.max(0, (value % reel.place) - (reel.place - 1));
        positionReel(reel, rotations + carry);
      });
    }
    showEP(0);

    let previousFrame = window.performance.now();
    const spin = (now) => {
      if (!current()) {
        stop();
        return;
      }
      const seconds = Math.min(0.1, Math.max(0, (now - previousFrame) / 1000));
      previousFrame = now;
      digits.forEach((reel, index) => {
        if (reel.spinning)
          positionReel(reel, reel.position + seconds * (24 + index * 2));
      });
      if (digits.some((reel) => reel.spinning))
        numberFrame = window.requestAnimationFrame(spin);
    };
    numberFrame = window.requestAnimationFrame(spin);
    if (!(await wait(650))) return false;

    card.dataset.revealPhase = "digits";
    for (let index = 0; index < digits.length; index++) {
      const reel = digits[index];
      reel.spinning = false;
      const from = reel.position;
      const digit = Number(reel.element.dataset.final);
      const to = Math.ceil((from + 10 - digit) / 10) * 10 + digit;
      if (
        !(await tween(260 + index * 85, (progress) =>
          positionReel(reel, from + (to - from) * easeOut(progress)),
        ))
      )
        return false;
      positionReel(reel, digit);
      reel.element.dataset.settled = "true";
      reel.element.classList.add("digit-settled");
    }
    window.cancelAnimationFrame(numberFrame);
    card.dataset.revealPhase = "pause";
    number.setAttribute("aria-label", `Your roll: ${finalNumber}`);
    if (!(await wait(900))) return false;

    card.dataset.revealPhase = "pop";
    number.classList.add("number-pop");
    if (!(await wait(650))) return false;
    number.classList.remove("number-reels", "number-pop");
    number.removeAttribute("role");
    number.removeAttribute("aria-label");
    number.textContent = finalNumber;
    card.dataset.revealPhase = "badges";
    status.textContent = `Your roll is ${finalNumber}. Revealing badges.`;

    const values = badges.map(({ badge }) =>
      Math.log1p(Math.max(0, Number(badge.ep) || 0)),
    );
    const lowest = values[0] || 0;
    const range = (values.at(-1) || 0) - lowest;
    let awardedEP = 0;
    for (let index = 0; index < badges.length; index++) {
      const { badge, node } = badges[index];
      const order = badges.length > 1 ? index / (badges.length - 1) : 0;
      const value = range ? (values[index] - lowest) / range : order;
      // Both order and badge value add suspense without making a rare roll
      // with many badges take longer than about 50 seconds.
      if (!(await wait(100 + order * 150 + value * 100))) return false;
      enableBadge(node);
      const duration = 300 + order * 260 + value * 220;
      node.style.setProperty("--badge-enter-duration", `${duration}ms`);
      node.classList.add("badge-enter");
      node.dataset.revealed = "true";
      const target =
        badge.isScoring === false
          ? awardedEP
          : Math.min(finalEP, awardedEP + Math.max(0, Number(badge.ep) || 0));
      const from = awardedEP;
      epPill.classList.toggle("ep-counting", target > from);
      if (
        !(await tween(duration, (progress) =>
          showEP(from + (target - from) * easeInOut(progress)),
        ))
      )
        return false;
      awardedEP = target;
      showEP(awardedEP);
      epPill.classList.remove("ep-counting");
      node.classList.remove("badge-enter");
      status.textContent = `${badge.name}. ${badge.isScoring === false ? "Another badge in this family scores." : `${format(badge.ep)} EP.`} Total ${format(awardedEP)} EP.`;
    }
    finished = true;
    return true;
  } finally {
    stop();
    signal?.removeEventListener("abort", stop);
    restoreFinal();
  }
}
