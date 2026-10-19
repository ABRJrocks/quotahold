import { Simulation } from "./simulation.js";
const $ = (id) => document.getElementById(id);
const node = (tag, text, cls) => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
};
let session = new Simulation();
let next = 1;
const time = (seconds) =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
function update(message = "Ready. Reserve a call to begin.", error = false) {
  const u = session.usage(),
    p = session.policy;
  $("available").textContent = u.available.toLocaleString();
  $("spent").textContent = u.spent.toLocaleString();
  $("held").textContent = u.held.toLocaleString();
  $("slots").textContent = `${u.inflight} / ${p.maxInflight} call slots held`;
  $("clock").textContent = time(session.now);
  const start = Math.floor(session.now / p.periodSeconds) * p.periodSeconds;
  $("window-label").textContent =
    `Current window: ${time(start)} to ${time(start + p.periodSeconds)}`;
  const denominator = Math.max(p.capacity, u.spent + u.held);
  $("spent-bar").style.width = `${(u.spent / denominator) * 100}%`;
  $("held-bar").style.width = `${(u.held / denominator) * 100}%`;
  $("rail").setAttribute(
    "aria-label",
    `${u.spent} settled units, ${u.held} held units, ${u.available} available units`,
  );
  $("overage").hidden = u.overage === 0;
  $("overage").textContent =
    `${u.overage} units above this window's capacity. Actual usage is kept visible; new work is denied.`;
  $("call-count").textContent =
    `${session.holds.length} calls in this rehearsal`;
  $("calls").replaceChildren();
  if (!session.holds.length)
    $("calls").append(
      node(
        "p",
        "No calls yet. Reserve allowance above to rehearse the lifecycle.",
        "empty",
      ),
    );
  for (const hold of [...session.holds].reverse()) {
    const row = node("article", undefined, "call");
    const info = node("div", undefined, "call-info");
    const title = node("div", undefined, "call-key");
    title.append(
      document.createTextNode(hold.key),
      node("span", hold.state, "state " + hold.state),
    );
    info.append(
      title,
      node(
        "p",
        `${hold.estimate} estimated units${hold.actual !== null ? " · " + hold.actual + " actual units" : ""} · admission window ${time(hold.windowStart)}`,
        "call-detail",
      ),
    );
    const actions = node("div", undefined, "call-actions");
    const action = (label, key, value) => {
      const b = node("button", label);
      b.setAttribute("aria-label", `${label} ${hold.key}`);
      b.addEventListener("click", () =>
        attempt(
          () => session.act(hold.id, key, value?.()),
          `${hold.key}: ${label.toLowerCase()} recorded.`,
        ),
      );
      actions.append(b);
    };
    if (hold.state === "reserved") {
      action("Start", "start");
      action("Cancel", "cancel");
    }
    if (hold.state === "started") action("Lose response", "uncertain");
    if (["started", "uncertain"].includes(hold.state)) {
      const label = node("label", "Actual units");
      const input = node("input");
      input.type = "number";
      input.min = "0";
      input.max = "1000000000";
      input.value = String(Math.floor(hold.estimate * 0.6));
      input.setAttribute("aria-label", `Actual units for ${hold.key}`);
      label.append(input);
      actions.append(label);
      action(
        hold.state === "uncertain" ? "Reconcile" : "Settle",
        "settle",
        () => Number(input.value),
      );
    }
    row.append(info, actions);
    $("calls").append(row);
  }
  $("activity").replaceChildren();
  for (const item of session.history) {
    const li = node("li");
    li.append(node("time", time(item.at), "mono"), node("span", item.message));
    $("activity").append(li);
  }
  $("message").className = "message" + (error ? " error" : "");
  $("message").textContent = message;
}
function attempt(action, message) {
  try {
    action();
    update(message);
  } catch (error) {
    update(error.message, true);
  }
}
$("policy-form").addEventListener("submit", (event) => {
  event.preventDefault();
  attempt(() => {
    session = new Simulation({
      capacity: Number($("capacity").value),
      maxInflight: Number($("concurrency").value),
      periodSeconds: Number($("period").value),
      unit: "units",
    });
    next = 1;
    $("request-key").value = "call-1";
  }, "Policy applied. Rehearsal reset.");
});
$("reserve-form").addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    const key = $("request-key").value;
    const result = session.reserve(key, Number($("estimate").value));
    if (result.kind === "reserved") $("request-key").value = `call-${++next}`;
    update(
      result.kind === "reserved"
        ? `${key}: allowance reserved.`
        : result.kind === "replay"
          ? `${key}: replay blocked. No new call is permitted.`
          : `${key}: denied by ${result.reason}.`,
      result.kind === "denied",
    );
  } catch (error) {
    update(error.message, true);
  }
});
$("advance-30").addEventListener("click", () =>
  attempt(
    () => session.advance(30),
    "Clock advanced. Unstarted deadlines were checked.",
  ),
);
$("advance-window").addEventListener("click", () =>
  attempt(
    () =>
      session.advance(
        session.policy.periodSeconds -
          (session.now % session.policy.periodSeconds),
      ),
    "New window. Started and uncertain calls still count.",
  ),
);
$("scenario").addEventListener("click", () => {
  session = new Simulation();
  session.reserve("report-worker", 80);
  session.act(1, "start");
  session.act(1, "uncertain");
  session.advance(60);
  $("capacity").value = "240";
  $("concurrency").value = "3";
  $("period").value = "60";
  $("request-key").value = "call-2";
  next = 2;
  update(
    "Response-loss scenario loaded. The unknown call still holds 80 units in the new window.",
  );
});
update();
