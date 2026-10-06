"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CircleDot,
  DatabaseBackup,
  Pause,
  Play,
  Plus,
  Send,
  TimerReset,
  Trash2,
} from "lucide-react";
import type { MarkerEvent } from "@/lib/morpheus";
import { downloadJson } from "@/lib/morpheus";
import type {
  ClockSyncState,
  SignalEngineState,
} from "@/lib/use-signal-engine";
import {
  protocolDigest,
  transitionTrial,
  scoreTrial,
  blindedScoringPacket,
  type TrialProtocol,
  deleteReinstatementTrial,
  listReinstatementTrials,
  putReinstatementTrial,
  summarizeReinstatement,
  type ReinstatementTrial,
} from "@/lib/reinstatement-store";
import { Panel, SectionHeader } from "./ui";

const delayConditions = [5, 30, 120, 600, 1800];

export default function ExperimentsPanel({
  gateway,
  emitMarker,
  clockSync,
}: {
  gateway: string;
  emitMarker: SignalEngineState["emitMarker"];
  clockSync: ClockSyncState;
}) {
  const [events, setEvents] = useState<MarkerEvent[]>([]);
  const [label, setLabel] = useState("AWAKE_REPORT");
  const [sending, setSending] = useState(false);
  const [armed, setArmed] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [recording, setRecording] = useState<{
    enabled: boolean;
    active: boolean;
    session_id?: string | null;
    samples?: number;
    markers?: number;
    path?: string | null;
    manifest_path?: string | null;
    sha256?: string | null;
  }>({ enabled: false, active: false });
  const [recordingBusy, setRecordingBusy] = useState(false);

  const [trials, setTrials] = useState<ReinstatementTrial[]>([]);
  const [delaySeconds, setDelaySeconds] = useState(30);
  const [intentionCondition, setIntentionCondition] = useState(false);
  const [preDreamId, setPreDreamId] = useState("");
  const [postDreamId, setPostDreamId] = useState("");
  const [continuityScore, setContinuityScore] = useState(3);
  const [notes, setNotes] = useState("");
  const [operatorId, setOperatorId] = useState("operator-001");
  const [scoringRule, setScoringRule] = useState("0: no shared structure; 1–2: partial overlap; 3–4: multiple matching events or spatial relationships; 5: detailed continuation. Score against sealed reports, not familiarity alone.");
  const [analysisPlan, setAnalysisPlan] = useState("Report counts, means and score ≥3 rates separately by delay and intention condition. Operator scores are unblinded; no causal or population inference.");
  const [trialError, setTrialError] = useState("");
  const [trialBusy, setTrialBusy] = useState(false);
  const [activeTrial, setActiveTrial] = useState<ReinstatementTrial | null>(null);

  useEffect(() => {
    let active = true;
    void listReinstatementTrials().then((rows) => {
      if (!active) return;
      setTrials(rows);
      const pendingTrial = rows.find((row) => row.schemaVersion === "reinstatement-trial-v2" && row.state !== "SCORED" && row.state !== "EXCLUDED") || null;
      setActiveTrial(pendingTrial);
      if (pendingTrial?.protocol) { setOperatorId(pendingTrial.protocol.operatorId); setPreDreamId(pendingTrial.preDreamId || ""); setDelaySeconds(pendingTrial.delaySeconds); setIntentionCondition(pendingTrial.intentionCondition); }
    }).catch((error: unknown) => { if (active) setTrialError(error instanceof Error ? error.message : "Trials could not be loaded."); });
    return () => { active = false; };
  }, []);

  const summary = useMemo(
    () => summarizeReinstatement(trials),
    [trials],
  );

  const refreshRecording = async () => {
    try {
      const response = await fetch(
        gateway.replace(/\/$/, "") + "/recording",
        { cache: "no-store" },
      );
      if (!response.ok) return;
      setRecording(await response.json());
    } catch {}
  };

  useEffect(() => {
    void refreshRecording();
    const timer = window.setInterval(
      () => void refreshRecording(),
      2500,
    );
    return () => window.clearInterval(timer);
  }, [gateway]);

  const toggleRecording = async () => {
    if (recordingBusy) return;
    setRecordingBusy(true);

    try {
      const base = gateway.replace(/\/$/, "");
      const response = await fetch(
        recording.active
          ? base + "/recording/stop"
          : base + "/recording/start",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: recording.active
            ? "{}"
            : JSON.stringify({
                session_id: sessionId.trim() || null,
              }),
        },
      );
      const payload = await response.json();

      if (recording.active) {
        setRecording((current) => ({
          ...current,
          active: false,
          manifest_path: payload.manifest_path,
          sha256: payload.sha256,
        }));
      } else if (payload.started) {
        setRecording((current) => ({
          ...current,
          active: true,
          session_id: payload.session_id,
          path: payload.path,
        }));
      }

      await refreshRecording();
    } finally {
      setRecordingBusy(false);
    }
  };

  const sendMarker = async (
    explicitLabel?: string,
    payload: Record<string, unknown> = {},
  ) => {
    const markerLabel = (explicitLabel || label).trim();
    if (!markerLabel || sending || !armed) return null;

    setSending(true);
    try {
      const result = await emitMarker(markerLabel, payload);
      const marker = result.marker;
      const event: MarkerEvent = {
        id: crypto.randomUUID(),
        label: markerLabel,
        timestamp: Number(
          marker?.timestamp || Date.now() / 1000,
        ),
        wall_timestamp: marker?.wall_timestamp,
        source: result.accepted ? "gateway" : "local",
        clock_domain:
          marker?.clock_domain || "browser_untrusted",
        timestamp_method: marker?.timestamp_method,
        temporal_status: marker?.temporal_status,
        hardware_trigger_verified: marker?.hardware_trigger_verified,
        sync_uncertainty_ms:
          marker?.sync_uncertainty_ms,
        transport: result.transport,
      };
      setEvents((current) =>
        [event, ...current].slice(0, 80),
      );
      return event;
    } finally {
      setSending(false);
    }
  };

  const withTrialError = async (action: () => Promise<void>) => {
    if (trialBusy) return;
    setTrialBusy(true); setTrialError("");
    try { await action(); }
    catch (error) { setTrialError(error instanceof Error ? error.message : "Trial operation failed. Local data was not advanced."); }
    finally { setTrialBusy(false); }
  };

  const startTrial = async () => {
    if (activeTrial) return;
    if (!operatorId.trim() || !scoringRule.trim() || !analysisPlan.trim() || !preDreamId.trim()) throw new Error("Enter the operator ID, pre-report ID, scoring rule and analysis plan before registration.");
    const createdAt = new Date().toISOString();
    const protocol: TrialProtocol = {
      version: "m2-protocol-v2", registeredAt: createdAt, operatorId: operatorId.trim(), delaySeconds,
      intentionCondition, assignment: "manual", scoringRule, analysisPlan, preDreamId: preDreamId.trim(),
    };
    const trial: ReinstatementTrial = {
      id: crypto.randomUUID(),
      sessionId:
        recording.session_id ||
        sessionId ||
        "m2-" + Date.now(),
      createdAt,
      schemaVersion: "reinstatement-trial-v2", protocol, protocolSha256: await protocolDigest(protocol),
      state: "CREATED", transitions: [{ state: "CREATED", at: createdAt, reason: "Local prospective protocol snapshot registered; manual condition assignment" }],
      delaySeconds,
      intentionCondition,
      preDreamId: preDreamId.trim() || undefined,
      continuityScore: null,
      blinded: false,
      notes: "",
    };

    await putReinstatementTrial(trial);
    setTrials((current) => [trial, ...current]);
    setActiveTrial(trial);

    if (armed) {
      await sendMarker("M2_TRIAL_START", {
        trial_id: trial.id,
        delay_seconds: delaySeconds,
        intention_condition: intentionCondition,
      });
    }
  };

  const markAwakening = async () => {
    if (!activeTrial || !armed) return;
    const marker = await sendMarker("AWAKEN", {
      trial_id: activeTrial.id,
      delay_seconds: activeTrial.delaySeconds,
    });
    if (!marker) return;
    const next = transitionTrial(activeTrial, "AWAKENED", `Operator awakening marker (${marker.source}; ${marker.clock_domain})`, new Date().toISOString(), marker.id);
    await putReinstatementTrial(next);
    setActiveTrial(next);
    setTrials((rows) => rows.map((row) => row.id === next.id ? next : row));
  };

  const completeTrial = async () => {
    if (!activeTrial) return;

    const complete = scoreTrial(activeTrial, continuityScore, postDreamId, notes, operatorId);

    await putReinstatementTrial(complete);
    setTrials((current) =>
      current.map((trial) =>
        trial.id === complete.id ? complete : trial,
      ),
    );

    setActiveTrial(null);
    setPostDreamId("");
    setNotes("");

    if (armed) {
      await sendMarker("M2_TRIAL_END", {
        trial_id: complete.id,
        continuity_score: complete.continuityScore,
        blinded: complete.blinded,
      });
    }
  };

  const excludeTrial = async (trial: ReinstatementTrial) => {
    const reason = window.prompt("Exclusion reason (retained in the trial history)");
    if (!reason?.trim()) return;
    const next = transitionTrial(trial, "EXCLUDED", reason.trim());
    await putReinstatementTrial(next);
    setTrials((rows) => rows.map((row) => row.id === next.id ? next : row));
    if (activeTrial?.id === next.id) setActiveTrial(null);
  };

  const removeTrial = async (id: string) => {
    if (!window.confirm("Delete this local trial and its protocol history? Export a backup first if it must be retained.")) return;
    await deleteReinstatementTrial(id);
    setTrials((current) =>
      current.filter((trial) => trial.id !== id),
    );
    if (activeTrial?.id === id) setActiveTrial(null);
  };

  return (
    <div className="space-y-4">
      {trialError ? <div role="alert" className="rounded-lg border border-red-400/30 bg-red-950/20 p-4 text-sm text-red-200">{trialError}</div> : null}
      <Panel>
        <SectionHeader
          eyebrow="M2 execution"
          title="Experiment control"
          description="Record prospective interruption protocols and marker provenance. Scores entered by this operator are unblinded. Independent assessor packets can be exported without delay or intention conditions."
          action={<button className="button-secondary" disabled={!trials.length} onClick={() => downloadJson("morpheus-m2-trials.json", { schema: "morpheus-reinstatement-export-v2", exportedAt: new Date().toISOString(), storagePlane: "local", trials })}>Export {trials.length} local trials</button>}
        />
        <div className="experiment-summary-grid">
          <div>
            <span>Completed</span>
            <strong>
              {
                trials.filter(
                  (trial) =>
                    trial.continuityScore !== null,
                ).length
              }
            </strong>
          </div>
          <div>
            <span>Conditions</span>
            <strong>{summary.length}</strong>
          </div>
          <div>
            <span>Marker clock</span>
            <strong>
              {clockSync.ready
                ? "SYNCED"
                : "UNSYNC"}
            </strong>
          </div>
          <div>
            <span>Recorder</span>
            <strong>
              {recording.active
                ? "ACTIVE"
                : recording.enabled
                  ? "READY"
                  : "LOCAL"}
            </strong>
          </div>
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[.72fr_1.28fr]">
        <Panel>
          <SectionHeader
            eyebrow="Local session recorder"
            title="Acquisition recording"
            description="Authoritative raw recording remains local. The hosted service cannot retain neural sessions."
            action={
              <span
                className={
                  recording.active
                    ? "tag"
                    : "tag-muted"
                }
              >
                {recording.active
                  ? "RECORDING"
                  : recording.enabled
                    ? "READY"
                    : "LOCAL ONLY"}
              </span>
            }
          />
          <div className="space-y-3 p-4">
            <label className="field-label">
              <span>Session ID</span>
              <input
                value={
                  recording.active
                    ? recording.session_id || ""
                    : sessionId
                }
                disabled={recording.active}
                onChange={(event) =>
                  setSessionId(
                    event.target.value
                      .replace(
                        /[^a-zA-Z0-9_-]/g,
                        "",
                      )
                      .slice(0, 96),
                  )
                }
                placeholder="m2-reinstatement-001"
                className="research-input"
              />
            </label>

            <button
              onClick={() => void toggleRecording()}
              disabled={
                recordingBusy ||
                (!recording.enabled &&
                  !recording.active)
              }
              className="button-primary w-full disabled:cursor-not-allowed disabled:opacity-40"
            >
              {recording.active ? (
                <Pause size={13} />
              ) : (
                <DatabaseBackup size={13} />
              )}
              {recordingBusy
                ? "Updating..."
                : recording.active
                  ? "Stop and seal recording"
                  : "Start local recording"}
            </button>

            <div className="grid grid-cols-2 gap-2">
              <ExperimentMetric
                label="Samples"
                value={String(recording.samples ?? 0)}
              />
              <ExperimentMetric
                label="Markers"
                value={String(recording.markers ?? 0)}
              />
            </div>

            {recording.sha256 ? (
              <div className="operator-note">
                Finalized SHA-256{" "}
                <span className="font-mono">
                  {recording.sha256.slice(0, 20)}…
                </span>
              </div>
            ) : null}

            {!recording.enabled ? (
              <div className="operator-note">
                Configure the local gateway recording
                directory or native Morpheus recorder to
                make this session authoritative.
              </div>
            ) : null}
          </div>
        </Panel>

        <Panel>
          <SectionHeader
            eyebrow="Synchronized control"
            title="Marker plane"
            description="Software markers retain timing class, transport and uncertainty. Hardware/DAQ markers remain the reference for protocols that require tighter timing."
            action={
              <button
                onClick={() =>
                  setArmed((value) => !value)
                }
                className={
                  armed
                    ? "mode-pill mode-pill-live"
                    : "mode-pill"
                }
              >
                {armed ? "ARMED" : "DISARMED"}
              </button>
            }
          />

          <div className="space-y-3 p-4">
            <label className="field-label">
              <span>Marker label</span>
              <input
                value={label}
                onChange={(event) =>
                  setLabel(
                    event.target.value
                      .toUpperCase()
                      .replace(/\s+/g, "_"),
                  )
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void sendMarker();
                  }
                }}
                className="research-input"
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              {[
                "DREAM_ONSET",
                "AWAKEN",
                "LUCID_SIGNAL",
                "REPORT_END",
              ].map((preset) => (
                <button
                  key={preset}
                  onClick={() => setLabel(preset)}
                  className="button-secondary justify-center text-[9px]"
                >
                  {preset}
                </button>
              ))}
            </div>

            <button
              onClick={() => void sendMarker()}
              disabled={!armed || sending}
              className="button-primary w-full disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send size={13} />
              {sending
                ? "Sending..."
                : armed
                  ? "Emit marker"
                  : "Arm marker plane first"}
            </button>

            <div className="operator-note">
              {clockSync.ready
                ? "SOFTWARE_SYNCED · ±" +
                  (
                    clockSync.uncertaintyMs ?? 0
                  ).toFixed(2) +
                  " ms · " +
                  clockSync.clockDomain
                : "SOFTWARE_UNSYNCED · browser timing is not authoritative"}
            </div>
          </div>
        </Panel>
      </div>

      <Panel>
        <SectionHeader
          eyebrow="Reinstatement trial"
          title="Controlled interruption protocol"
          description="Register a local protocol snapshot before the awakening. Manual assignment, scoring rule and analysis plan are sealed with a digest. This records intent; it is not external preregistration or hardware timing verification."
          action={
            activeTrial ? (
              <span className="tag">
                TRIAL ACTIVE
              </span>
            ) : (
              <span className="tag-muted">
                READY
              </span>
            )
          }
        />

        <div className="reinstatement-grid">
          <div className="reinstatement-control">
            <label className="field-label mb-3 block"><span>Operator / annotator ID</span><input className="research-input" value={operatorId} disabled={Boolean(activeTrial)} onChange={(event) => setOperatorId(event.target.value)} /></label>
            <label className="field-label">
              <span>Return-to-sleep delay</span>
              <select
                className="research-input"
                value={delaySeconds}
                disabled={Boolean(activeTrial)}
                onChange={(event) =>
                  setDelaySeconds(
                    Number(event.target.value),
                  )
                }
              >
                {delayConditions.map((delay) => (
                  <option key={delay} value={delay}>
                    {delay < 60
                      ? delay + " seconds"
                      : delay / 60 + " minutes"}
                  </option>
                ))}
              </select>
            </label>

            <button
              className={
                intentionCondition
                  ? "dataset-control-card dataset-control-card-active mt-3 w-full"
                  : "dataset-control-card mt-3 w-full"
              }
              disabled={Boolean(activeTrial)}
              onClick={() =>
                setIntentionCondition(
                  (value) => !value,
                )
              }
            >
              <span>Intention condition</span>
              <div className="mt-2 text-xs">
                {intentionCondition
                  ? "Pre-registered continuation intention"
                  : "No deliberate continuation instruction"}
              </div>
            </button>

            <label className="field-label mt-3 block">
              <span>Pre-awakening Dream ID</span>
              <input
                className="research-input"
                value={preDreamId}
                disabled={Boolean(activeTrial)}
                onChange={(event) =>
                  setPreDreamId(event.target.value)
                }
                placeholder="Sealed Dataset Zero report ID"
              />
            </label>

            <label className="field-label mt-3 block"><span>Prospective scoring rule</span><textarea className="dataset-textarea" rows={4} value={activeTrial?.protocol?.scoringRule || scoringRule} disabled={Boolean(activeTrial)} onChange={(event) => setScoringRule(event.target.value)} /></label>
            <label className="field-label mt-3 block"><span>Analysis plan</span><textarea className="dataset-textarea" rows={3} value={activeTrial?.protocol?.analysisPlan || analysisPlan} disabled={Boolean(activeTrial)} onChange={(event) => setAnalysisPlan(event.target.value)} /></label>
            {!activeTrial ? (
              <button
                className="button-primary mt-4 w-full"
                disabled={trialBusy}
                onClick={() => void withTrialError(startTrial)}
              >
                <Play size={13} />
                Pre-register trial
              </button>
            ) : (
              <button
                className="button-secondary mt-4 w-full"
                disabled={!armed || trialBusy || activeTrial.state !== "CREATED"}
                onClick={() => void withTrialError(markAwakening)}
              >
                <TimerReset size={13} />
                Emit AWAKEN marker
              </button>
            )}
          </div>

          <div className="reinstatement-score">
            {activeTrial ? (
              <>
                <div className="program-label">
                  Active trial
                </div>
                <div className="reinstatement-active">
                  <strong>
                    {activeTrial.delaySeconds < 60
                      ? activeTrial.delaySeconds +
                        " s"
                      : activeTrial.delaySeconds /
                          60 +
                        " min"}
                  </strong>
                  <span>
                    {activeTrial.intentionCondition
                      ? "INTENTION"
                      : "CONTROL"}
                  </span>
                </div>

                <label className="field-label mt-4 block">
                  <span>
                    Post-return Dream ID
                  </span>
                  <input
                    className="research-input"
                    value={postDreamId}
                    onChange={(event) =>
                      setPostDreamId(
                        event.target.value,
                      )
                    }
                  />
                </label>

                <label className="field-label mt-4 block">
                  <span>
                    Continuity score ·{" "}
                    {continuityScore}/5
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="5"
                    value={continuityScore}
                    onChange={(event) =>
                      setContinuityScore(
                        Number(event.target.value),
                      )
                    }
                    className="mt-2 w-full"
                  />
                </label>

                <p className="mt-3 text-sm text-slate-400">Operator score · unblinded. The condition is visible in this workstation.</p>
                <p className="mt-2 text-xs text-slate-500">State: {activeTrial.state} · protocol {activeTrial.protocol?.version}<br />Digest: {activeTrial.protocolSha256?.slice(0, 20)}…</p>

                <label className="field-label mt-4 block">
                  <span>Scoring notes</span>
                  <textarea
                    className="dataset-textarea mt-2"
                    rows={4}
                    value={notes}
                    onChange={(event) =>
                      setNotes(event.target.value)
                    }
                  />
                </label>

                <button
                  className="button-primary mt-4 w-full"
                  disabled={trialBusy || !postDreamId.trim()}
                  onClick={() => void withTrialError(completeTrial)}
                >
                  Complete trial
                </button>
              </>
            ) : (
              <div className="research-empty">
                No active trial. Fix the delay
                condition before awakening, then
                score the post-return report against
                the pre-registered continuity rule.
              </div>
            )}
          </div>
        </div>
      </Panel>

      <Panel>
        <SectionHeader
          eyebrow="M2 local dataset"
          title="Descriptive condition summary"
          description="Conditions, protocol versions and claimed blinding remain separate. Excluded trials are retained but omitted. Means and rates are descriptive, without significance or causal claims."
          action={
            <span className="tag-muted">
              {summary.length} CONDITIONS
            </span>
          }
        />

        {summary.length ? (
          <div className="reinstatement-summary">
            {summary.map((row) => (
              <div key={`${row.delaySeconds}-${row.intentionCondition}-${row.blinded}-${row.protocolVersion}`}>
                <span>
                  {row.delaySeconds < 60
                    ? row.delaySeconds + " s"
                    : row.delaySeconds / 60 + " min"}
                </span>
                <strong>
                  mean {row.meanScore.toFixed(2)}/5
                </strong>
                <small>
                  {(row.continuationRate * 100).toFixed(0)}
                  % ≥3 · n={row.n} · {row.intentionCondition ? "intention" : "control"} · {row.blinded ? "claimed blind (legacy if applicable)" : "unblinded"} · {row.protocolVersion}
                </small>
              </div>
            ))}
          </div>
        ) : (
          <div className="research-empty m-4">
            Completed trials appear here without
            uploading the reports or scores.
          </div>
        )}

        {trials.length ? (
          <div className="divide-y divide-white/[.055] border-t border-white/[.055]">
            {trials.slice(0, 20).map((trial) => (
              <div
                key={trial.id}
                className="reinstatement-trial-row"
              >
                <div>
                  <strong>
                    {trial.delaySeconds}s ·{" "}
                    {trial.intentionCondition
                      ? "INTENTION"
                      : "CONTROL"}
                  </strong>
                  <span>
                    {trial.continuityScore === null
                      ? "PENDING"
                      : "SCORE " +
                        trial.continuityScore +
                        "/5"}
                    {" · "}
                    {trial.blinded
                      ? "BLINDED"
                      : "UNBLINDED"}
                  </span>
                </div>
                <button className="button-secondary" onClick={() => downloadJson("m2-assessor-packet.json", blindedScoringPacket(trial, crypto.randomUUID()))}>Assessor packet</button>
                {trial.schemaVersion === "reinstatement-trial-v2" && trial.state !== "EXCLUDED" ? <button className="button-secondary" disabled={trialBusy} onClick={() => void withTrialError(() => excludeTrial(trial))}>Exclude with reason</button> : null}
                {trial.state === "EXCLUDED" ? <span className="text-xs text-slate-400">Excluded: {trial.exclusionReason}</span> : null}
                <button
                  className="button-icon"
                  title="Delete local trial"
                  onClick={() =>
                    void withTrialError(() => removeTrial(trial.id))
                  }
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </Panel>

      <Panel>
        <SectionHeader
          eyebrow="Event timeline"
          title="Current browser session"
          action={
            <span className="tag-muted">
              {events.length} EVENTS
            </span>
          }
        />

        {events.length ? (
          <div className="divide-y divide-white/[.055]">
            {events.map((event, index) => (
              <div
                key={event.id}
                className="grid grid-cols-[28px_1fr_auto] items-center gap-3 px-4 py-3"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[.07] bg-black/20 text-slate-500">
                  {index === 0 ? (
                    <Play size={12} />
                  ) : (
                    <CircleDot size={11} />
                  )}
                </span>
                <div>
                  <div className="font-mono text-xs text-slate-300">
                    {event.label}
                  </div>
                  <div className="mt-1 text-[10px] text-slate-650">
                    {event.clock_domain ||
                      "unknown clock"}
                    {" · "}
                    {event.timestamp_method ||
                      "unknown method"}
                    {" · "}
                    {event.temporal_status === "software_clock_mapped"
                      ? "software clock mapped; hardware trigger unverified"
                      : "arrival time only; not time-lock verified"}
                    {event.sync_uncertainty_ms != null
                      ? " · ±" +
                        event.sync_uncertainty_ms.toFixed(
                          2,
                        ) +
                        " ms"
                      : ""}
                  </div>
                </div>
                <span
                  className={
                    event.source === "gateway"
                      ? "tag-muted !text-emerald-300"
                      : "tag-muted"
                  }
                >
                  {event.source}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex min-h-48 flex-col items-center justify-center px-6 text-center">
            <TimerReset
              size={24}
              className="text-slate-700"
            />
            <p className="mt-3 text-xs text-slate-600">
              No markers in this browser session.
            </p>
            <button
              onClick={() =>
                setLabel("SESSION_START")
              }
              className="mt-4 button-secondary"
            >
              <Plus size={12} />
              Prepare session start
            </button>
          </div>
        )}
      </Panel>
    </div>
  );
}

function ExperimentMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="experiment-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
