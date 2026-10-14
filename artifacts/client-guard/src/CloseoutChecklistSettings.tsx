import { useEffect, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetCloseoutChecklistSettingsQueryKey,
  useGetCloseoutChecklistSettings,
  useUpdateCloseoutChecklistSettings,
} from "@workspace/api-client-react";
import type { CloseoutChecklistDefinition } from "@workspace/api-client-react";
import { Plus, ShieldCheck, Trash2 } from "lucide-react";

const panel = "rounded-md border border-[#e0dace] bg-[#fbfaf5]";
const button = "inline-flex items-center justify-center gap-2 rounded-md bg-[#294651] px-3.5 py-2.5 text-xs font-semibold text-[#f9f6ed] transition hover:bg-[#1c3943] disabled:cursor-not-allowed disabled:opacity-50";
const outlined = "inline-flex items-center justify-center gap-2 rounded-md border border-[#d9d4c8] bg-[#fbfaf5] px-3 py-2 text-xs font-semibold text-[#40575b] transition hover:bg-[#f1eee6] disabled:opacity-50";
const errorText = (error: unknown) => error instanceof Error
  ? error.message
  : "The checklist settings could not be saved.";

export default function CloseoutChecklistSettings({
  isAdmin,
  matterTypes,
}: {
  isAdmin: boolean;
  matterTypes: string[];
}) {
  const queryClient = useQueryClient();
  const settings = useGetCloseoutChecklistSettings();
  const save = useUpdateCloseoutChecklistSettings();
  const [checklists, setChecklists] = useState<CloseoutChecklistDefinition[]>([]);
  const [selectedType, setSelectedType] = useState("");
  const [newType, setNewType] = useState("");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (settings.data && !dirty) {
      setChecklists(settings.data.checklists);
      if (selectedType &&
        !settings.data.checklists.some((entry) => entry.matterType === selectedType) &&
        !matterTypes.some((type) => type.trim() === selectedType)) {
        setSelectedType("");
      }
    }
  }, [settings.data, dirty, selectedType, matterTypes]);

  const selectedDefinition = checklists.find((entry) => entry.matterType === (selectedType || null));
  const defaultDefinition = checklists.find((entry) => entry.matterType === null);
  const current = selectedDefinition ?? (defaultDefinition
    ? { matterType: selectedType || null, items: defaultDefinition.items }
    : undefined);
  const inheritsDefault = Boolean(selectedType && !selectedDefinition);
  const updatedAt = settings.data?.updatedAt;
  const types = [...new Set([
    ...matterTypes.map((type) => type.trim()).filter(Boolean),
    ...checklists.map((entry) => entry.matterType).filter((type): type is string => type !== null),
  ])].sort((a, b) => a.localeCompare(b));

  function editCurrent(update: (current: CloseoutChecklistDefinition) => CloseoutChecklistDefinition) {
    if (!current) return;
    setChecklists((existing) => existing.some((entry) => entry.matterType === current.matterType)
      ? existing.map((entry) => entry.matterType === current.matterType ? update(entry) : entry)
      : [...existing, update(current)]);
    setDirty(true);
    setSuccess("");
  }

  function addMatterType() {
    const type = newType.trim();
    if (!type) return;
    const existing = checklists.find((entry) =>
      entry.matterType?.toLocaleLowerCase() === type.toLocaleLowerCase(),
    );
    if (existing) {
      setSelectedType(existing.matterType ?? "");
      setNewType("");
      return;
    }
    const defaults = checklists.find((entry) => entry.matterType === null);
    if (!defaults) return;
    const scoped = { matterType: type, items: defaults.items.map((item) => ({ ...item })) };
    setChecklists((items) => [...items, scoped]);
    setSelectedType(type);
    setNewType("");
    setDirty(true);
    setSuccess("");
  }

  function saveSettings(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    const normalized = checklists.map((list) => ({
      ...list,
      matterType: list.matterType?.trim() || null,
      items: list.items.map((item) => ({ ...item, title: item.title.trim() })),
    }));
    if (normalized.some((list) => list.items.length === 0 || list.items.some((item) => !item.title))) {
      setError("Each checklist needs at least one step, and every step needs a title.");
      return;
    }
    const typeKeys = normalized.filter((list) => list.matterType !== null)
      .map((list) => list.matterType!.toLocaleLowerCase());
    if (normalized.filter((list) => list.matterType === null).length !== 1 ||
      new Set(typeKeys).size !== typeKeys.length) {
      setError("Keep one all-matters checklist and use each matter type only once.");
      return;
    }
    save.mutate({ data: { checklists: normalized } }, {
      onSuccess: (result) => {
        setChecklists(result.checklists);
        setDirty(false);
        setSuccess("Required closeout checklist saved. Open matters keep their existing checklist.");
        queryClient.invalidateQueries({ queryKey: getGetCloseoutChecklistSettingsQueryKey() });
      },
      onError: (cause) => setError(errorText(cause)),
    });
  }

  function addItem() {
    const itemKey = `custom_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`;
    editCurrent((entry) => ({
      ...entry,
      items: [...entry.items, { itemKey, title: "" }],
    }));
  }

  if (settings.isLoading || (settings.data && !current)) {
    return <div className={`${panel} mb-5 h-40 animate-pulse bg-[#e8e4d9]`} aria-label="Loading closeout settings" />;
  }

  if (settings.isError || !current) {
    return <section className={`${panel} mb-5 p-5`} aria-label="Closeout checklist settings">
      <h2 className="serif text-lg font-bold">Required closeout checklist</h2>
      <p role="alert" className="mt-2 text-xs text-[#843f38]">
        {settings.isError ? `Checklist settings could not be loaded. ${errorText(settings.error)}` : "No all-matters checklist is configured."}
      </p>
      <button type="button" onClick={() => settings.refetch()} className={`${outlined} mt-3`}>Retry</button>
    </section>;
  }

  return <section className={`${panel} mb-5 overflow-hidden`} aria-label="Closeout checklist settings">
    <div className="flex items-start gap-3 border-b border-[#e9e4d9] px-5 py-4">
      <ShieldCheck className="mt-0.5 h-5 w-5 text-[#527861]" />
      <div>
        <h2 className="serif text-lg font-bold">Required closeout checklist</h2>
        <p className="mt-1 text-xs leading-5 text-[#788581]">
          Set the steps a matter must complete before it can close. The selected checklist is copied onto a matter when closeout starts, so later policy changes do not alter active checklists.
        </p>
      </div>
    </div>
    <form onSubmit={saveSettings} className="grid gap-4 p-5">
      <label className="max-w-md text-xs font-semibold">
        Checklist applies to
        <select
          className="field mt-1"
          value={selectedType}
          onChange={(event) => setSelectedType(event.target.value)}
          disabled={!isAdmin}
        >
          <option value="">All matter types (default)</option>
          {types.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
      </label>
      {inheritsDefault && <p className="text-[10px] text-[#89918c]">
        This matter type currently uses the all-matters checklist. Editing and saving creates a type-specific override.
      </p>}
      {isAdmin && <div className="flex max-w-xl flex-wrap gap-2">
        <label className="min-w-[220px] flex-1 text-xs font-semibold">
          Add a matter type checklist
          <input
            className="field mt-1"
            value={newType}
            maxLength={160}
            onChange={(event) => setNewType(event.target.value)}
            placeholder="For example, Commercial lease"
          />
        </label>
        <button type="button" onClick={addMatterType} className={`${outlined} self-end`}><Plus className="h-3.5 w-3.5" />Add matter type</button>
      </div>}
      <div className="max-w-3xl divide-y divide-[#eee9df] rounded border border-[#e7e2d7]">
        {current.items.map((item, index) => <div key={item.itemKey} className="flex items-center gap-3 p-3">
          <span className="mono text-[10px] text-[#92754a]">{String(index + 1).padStart(2, "0")}</span>
          <input
            className="field min-w-0 flex-1"
            aria-label={`Closeout step ${index + 1}`}
            value={item.title}
            maxLength={200}
            disabled={!isAdmin}
            onChange={(event) => editCurrent((entry) => ({
              ...entry,
              items: entry.items.map((row) => row.itemKey === item.itemKey
                ? { ...row, title: event.target.value }
                : row),
            }))}
          />
          {isAdmin && <button
            type="button"
            className={`${outlined} px-2`}
            aria-label={`Remove closeout step ${index + 1}`}
            disabled={current.items.length <= 1}
            onClick={() => editCurrent((entry) => ({
              ...entry,
              items: entry.items.filter((row) => row.itemKey !== item.itemKey),
            }))}
          ><Trash2 className="h-3.5 w-3.5" /></button>}
        </div>)}
      </div>
      {isAdmin && <div className="flex flex-wrap gap-2">
        <button type="button" onClick={addItem} className={outlined} disabled={current.items.length >= 30}>
          <Plus className="h-3.5 w-3.5" />Add required step
        </button>
        {selectedType && <button
          type="button"
          className={outlined}
          onClick={() => {
            setChecklists((items) => items.filter((entry) => entry.matterType !== selectedType));
            setSelectedType("");
            setDirty(true);
            setSuccess("");
          }}
        >Use all-matters default for this type</button>}
        <button type="submit" className={button} disabled={save.isPending || !dirty}>
          {save.isPending ? "Saving…" : "Save closeout checklist"}
        </button>
      </div>}
      {!isAdmin && <p className="text-[10px] text-[#89918c]">Only firm owners and admins can change required steps.</p>}
      {error && <p role="alert" className="text-xs text-[#843f38]">{error}</p>}
      {success && <p role="status" className="text-xs text-[#42664f]">{success}</p>}
      {updatedAt && <p className="text-[10px] text-[#89918c]">Last changed {new Date(updatedAt).toLocaleString()}.</p>}
    </form>
  </section>;
}
