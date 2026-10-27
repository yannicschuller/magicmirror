import { useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, Loader2, MapPin, Plus, Search, TramFront, X } from 'lucide-react';
import { cn } from 'cn';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { IconButton } from '@/components/icon-button';
import { WasteServiceField } from '@/components/waste-service-field';
import { api, errorMessage, keyOf } from '@/lib/api';
import { applyDefaults, type Field, type Option, type Values } from '@/lib/shared';
import { useStore } from '@/lib/store';

// ---- small building blocks ------------------------------------------------------------------

/** Strip a leading "+ " from a message so it can be shown next to a plus icon. */
export const noPlus = (s: string) => s.replace(/^\+\s*/, '');

/**
 * Number input that keeps what the user types while focused and only reports valid numbers
 * (so "-" or an empty field never ends up in the config).
 */
export function NumberInput({
  value,
  onValue,
  className,
  ...props
}: { value: number | undefined | null; onValue: (n: number) => void } & Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'type'>) {
  const [text, setText] = useState(value === undefined || value === null ? '' : String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value === undefined || value === null ? '' : String(value));
  }, [value]);
  return (
    <Input
      {...props}
      type="number"
      inputMode="decimal"
      className={className}
      value={text}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        setText(value === undefined || value === null ? '' : String(value));
      }}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value !== '' && Number.isFinite(n)) onValue(n);
      }}
    />
  );
}

/** shadcn Select over {value,label} options (labels are message ids). */
export function OptionSelect({
  value,
  options,
  onValue,
  id,
  className,
  translate = true,
}: {
  value: string;
  options: Option[];
  onValue: (v: string) => void;
  id?: string;
  className?: string;
  translate?: boolean;
}) {
  const { t } = useStore();
  // Radix Select does not allow empty-string values.
  const enc = (v: string) => (v === '' ? '__empty__' : v);
  const dec = (v: string) => (v === '__empty__' ? '' : v);
  return (
    <Select value={enc(value)} onValueChange={(v) => onValue(dec(v))}>
      <SelectTrigger id={id} className={cn('w-full', className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-80">
        {options.map((o) => (
          <SelectItem key={o.value} value={enc(o.value)}>
            {translate ? t(o.label) : o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Pill-shaped checkbox used for multi-selects and page assignment. */
export function CheckChip({
  checked,
  disabled,
  onChange,
  children,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label
      className={cn(
        'inline-flex cursor-pointer items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-[13px] transition-colors select-none hover:border-ring/60',
        checked && 'border-primary/70 bg-primary/10',
        disabled && 'cursor-default opacity-50',
      )}
    >
      <Checkbox checked={checked} disabled={disabled} onCheckedChange={(c) => onChange(c === true)} />
      <span>{children}</span>
    </label>
  );
}

function FieldRow({ field, children, wide, htmlFor }: { field: Field; children: ReactNode; wide?: boolean; htmlFor?: string }) {
  const { t } = useStore();
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', wide && 'col-span-full')}>
      <Label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {t(field.label)}
      </Label>
      {children}
      {field.help && <p className="text-xs text-muted-foreground">{t(field.help)}</p>}
    </div>
  );
}

// ---- generic form ---------------------------------------------------------------------------

function isVisible(field: Field, values: Values) {
  if (!field.showIf) return true;
  return Object.entries(field.showIf).every(([k, v]) => {
    if (k === '_transitCustom') return values.provider === 'hafas' || values.efaPreset === 'custom';
    return values[k] === v;
  });
}

/**
 * Renders `fields` editing the object `values` in place; `onChange` runs after every edit.
 */
export function FieldsForm({
  fields,
  values,
  onChange,
  compact = false,
}: {
  fields: Field[];
  values: Values;
  onChange: () => void;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'grid gap-x-5 gap-y-4',
        compact ? 'grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-x-4 gap-y-3' : 'grid-cols-[repeat(auto-fill,minmax(260px,1fr))]',
      )}
    >
      {fields.filter((f) => isVisible(f, values)).map((f) => (
        <FieldInput key={f.key} field={f} values={values} onChange={onChange} />
      ))}
    </div>
  );
}

function FieldInput({ field, values, onChange }: { field: Field; values: Values; onChange: () => void }) {
  const { t } = useStore();
  const id = useId();
  const v = values[field.key];
  const set = (val: unknown) => {
    values[field.key] = val;
    onChange();
  };

  switch (field.type) {
    case 'bool':
      return (
        <label htmlFor={id} className="flex cursor-pointer items-center gap-3 py-1.5 text-sm">
          <Switch id={id} checked={!!v} onCheckedChange={(c) => set(c)} />
          <span>{t(field.label)}</span>
        </label>
      );
    case 'number':
      return (
        <FieldRow field={field} htmlFor={id}>
          <NumberInput id={id} value={v} min={field.min} max={field.max} step={field.step || 1} onValue={set} />
        </FieldRow>
      );
    case 'select':
      return (
        <FieldRow field={field} htmlFor={id}>
          <OptionSelect id={id} value={v} options={field.options || []} onValue={set} />
        </FieldRow>
      );
    case 'multiselect':
      return (
        <FieldRow field={field} wide>
          <div className="flex flex-wrap gap-1.5">
            {(field.options || []).map((o) => (
              <CheckChip
                key={o.value}
                checked={(v as string[]).includes(o.value)}
                onChange={(c) => {
                  // keep the option order stable
                  const sel = new Set(v as string[]);
                  if (c) sel.add(o.value);
                  else sel.delete(o.value);
                  set((field.options || []).map((x) => x.value).filter((x) => sel.has(x)));
                }}
              >
                {t(o.label)}
              </CheckChip>
            ))}
          </div>
        </FieldRow>
      );
    case 'color':
      return (
        <FieldRow field={field} htmlFor={id}>
          <ColorInput id={id} label={t(field.label)} value={v} onValue={set} />
        </FieldRow>
      );
    case 'textarea':
      return (
        <FieldRow field={field} htmlFor={id} wide>
          <Textarea id={id} rows={4} value={v ?? ''} onChange={(e) => set(e.target.value)} />
        </FieldRow>
      );
    case 'date':
    case 'time':
      return (
        <FieldRow field={field} htmlFor={id}>
          <Input id={id} type={field.type} value={v ?? ''} onChange={(e) => set(e.target.value)} className="[color-scheme:dark]" />
        </FieldRow>
      );
    case 'location':
      return (
        <FieldRow field={field} wide>
          <LocationField value={v} onValue={set} />
        </FieldRow>
      );
    case 'transitStop':
      return (
        <FieldRow field={field} wide>
          <TransitStopField value={v} values={values} onValue={set} />
        </FieldRow>
      );
    case 'wasteService':
      return (
        <FieldRow field={field} wide>
          <WasteServiceField value={v} values={values} onValue={set} />
        </FieldRow>
      );
    case 'list':
      return <ListField field={field} values={values} onChange={onChange} />;
    default:
      return (
        <FieldRow field={field} htmlFor={id} wide={field.secret}>
          <Input
            id={id}
            type={field.secret ? 'url' : 'text'}
            value={v ?? ''}
            placeholder={field.placeholder ? t(field.placeholder) : undefined}
            autoComplete={field.secret ? 'off' : undefined}
            spellCheck={field.secret ? false : undefined}
            className={field.secret ? 'font-mono text-[13px]' : undefined}
            onChange={(e) => set(e.target.value)}
          />
        </FieldRow>
      );
  }
}

function ColorInput({ id, label, value, onValue }: { id: string; label: string; value: string; onValue: (v: string) => void }) {
  const [text, setText] = useState(value ?? '');
  useEffect(() => setText(value ?? ''), [value]);
  const valid = /^#[0-9a-f]{3,8}$/i.test(text);
  return (
    <div className="flex gap-2">
      <input
        type="color"
        aria-label={label}
        value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'}
        onChange={(e) => onValue(e.target.value)}
        className="h-8 w-11 shrink-0 cursor-pointer rounded-lg border border-input bg-transparent p-0.5"
      />
      <Input
        id={id}
        value={text}
        maxLength={9}
        aria-invalid={!valid || undefined}
        className="font-mono text-[13px]"
        onChange={(e) => {
          setText(e.target.value);
          if (/^#[0-9a-f]{3,8}$/i.test(e.target.value)) onValue(e.target.value);
        }}
        onBlur={() => setText(value ?? '')}
      />
    </div>
  );
}

// ---- search widgets -------------------------------------------------------------------------

type SearchState<R> = { status: 'idle' } | { status: 'loading' } | { status: 'done'; results: R[] } | { status: 'error'; message: string };

function SearchBox<R>({
  placeholder,
  search,
  renderResult,
  onPick,
}: {
  placeholder: string;
  search: (q: string) => Promise<R[]>;
  renderResult: (r: R) => ReactNode;
  onPick: (r: R) => void;
}) {
  const { t } = useStore();
  const [q, setQ] = useState('');
  const [state, setState] = useState<SearchState<R>>({ status: 'idle' });
  const run = async () => {
    setState({ status: 'loading' });
    try {
      setState({ status: 'done', results: await search(q) });
    } catch (err) {
      setState({ status: 'error', message: t(errorMessage(err)) });
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={q}
            placeholder={placeholder}
            className="pl-8"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                run();
              }
            }}
          />
        </div>
        <Button type="button" variant="secondary" onClick={run} disabled={state.status === 'loading'}>
          {state.status === 'loading' && <Loader2 className="animate-spin" />}
          {t('Search')}
        </Button>
      </div>
      {state.status === 'loading' && <p className="text-xs text-muted-foreground">{t('Searching …')}</p>}
      {state.status === 'error' && <p className="text-xs text-destructive">{state.message}</p>}
      {state.status === 'done' &&
        (state.results.length ? (
          <div className="flex flex-col overflow-hidden rounded-lg border bg-background">
            {state.results.map((r, i) => (
              <button
                key={i}
                type="button"
                className="flex items-baseline gap-2 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                onClick={() => {
                  onPick(r);
                  setState({ status: 'idle' });
                }}
              >
                {renderResult(r)}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t('Nothing found')}</p>
        ))}
    </div>
  );
}

function Current({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg bg-secondary px-3 py-2 text-sm [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-primary">
      {icon}
      <div className="min-w-0 truncate">{children}</div>
    </div>
  );
}

type Loc = { name: string; lat: number; lon: number };
type GeoResult = { name: string; region: string; lat: number; lon: number };

function LocationField({ value, onValue }: { value: Loc | null; onValue: (v: Loc) => void }) {
  const { t } = useStore();
  const [name, setName] = useState(value?.name || '');
  const [lat, setLat] = useState(value?.lat !== undefined ? String(value.lat) : '');
  const [lon, setLon] = useState(value?.lon !== undefined ? String(value.lon) : '');
  return (
    <div className="flex flex-col gap-2">
      <Current icon={<MapPin />}>
        {value ? (
          <>
            <b className="font-semibold">{value.name || t('Location')}</b>{' '}
            <span className="text-muted-foreground tabular-nums">
              {value.lat.toFixed(4)}, {value.lon.toFixed(4)}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">{t('No location set')}</span>
        )}
      </Current>
      <SearchBox<GeoResult>
        placeholder={t('Search for a place, e.g. Stuttgart')}
        search={(q) => api(`/geocode?q=${encodeURIComponent(q)}`)}
        renderResult={(r) => (
          <>
            <b className="font-semibold">{r.name}</b> <span className="text-xs text-muted-foreground">{r.region}</span>
          </>
        )}
        onPick={(r) => {
          onValue({ name: r.name, lat: r.lat, lon: r.lon });
          setName(r.name);
          setLat(String(r.lat));
          setLon(String(r.lon));
        }}
      />
      <Collapsible>
        <CollapsibleTrigger className="group flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
          {t('Enter coordinates manually')}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
            <Input className="col-span-2 sm:col-span-1" placeholder={t('Name')} value={name} onChange={(e) => setName(e.target.value)} />
            <Input type="number" step="0.0001" placeholder={t('Latitude')} value={lat} onChange={(e) => setLat(e.target.value)} />
            <Input type="number" step="0.0001" placeholder={t('Longitude')} value={lon} onChange={(e) => setLon(e.target.value)} />
            <Button
              type="button"
              variant="secondary"
              className="col-span-2 sm:col-span-1"
              onClick={() => {
                const la = Number(lat);
                const lo = Number(lon);
                if (lat !== '' && lon !== '' && Number.isFinite(la) && Number.isFinite(lo)) onValue({ name: name || t('Location'), lat: la, lon: lo });
              }}
            >
              {t('Apply')}
            </Button>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

type Stop = { id: string; name: string };

function TransitStopField({ value, values, onValue }: { value: Stop | null; values: Values; onValue: (v: Stop) => void }) {
  const { t } = useStore();
  return (
    <div className="flex flex-col gap-2">
      <Current icon={<TramFront />}>
        {value ? (
          <>
            <b className="font-semibold">{value.name}</b> <span className="text-xs text-muted-foreground">{value.id}</span>
          </>
        ) : (
          <span className="text-muted-foreground">{t('No stop selected')}</span>
        )}
      </Current>
      <SearchBox<Stop>
        placeholder={t('Search for a stop')}
        search={(q) => api('/transit/search', { method: 'POST', body: { settings: values, q } })}
        renderResult={(r) => (
          <>
            <b className="font-semibold">{r.name}</b> <span className="text-xs text-muted-foreground">{r.id}</span>
          </>
        )}
        onPick={(r) => onValue({ id: r.id, name: r.name })}
      />
    </div>
  );
}

// ---- list -----------------------------------------------------------------------------------

function ListField({ field, values, onChange }: { field: Field; values: Values; onChange: () => void }) {
  const { t, mt } = useStore();
  const itemLabel = t(field.itemLabel || 'Entry');
  const arr = values[field.key] as Values[];
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    onChange();
  };
  return (
    <div className="col-span-full flex min-w-0 flex-col gap-2">
      <Label className="text-xs font-medium text-muted-foreground">{t(field.label)}</Label>
      <div className="flex flex-col gap-2.5">
        {arr.map((item, i) => (
          <div key={keyOf(item)} className="rounded-xl border bg-background/60 px-3 pt-2 pb-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                {itemLabel} {i + 1}
              </span>
              <span className="flex gap-0.5">
                <IconButton label={t('Move up')} onClick={() => move(i, -1)} disabled={i === 0}>
                  <ArrowUp />
                </IconButton>
                <IconButton label={t('Move down')} onClick={() => move(i, 1)} disabled={i === arr.length - 1}>
                  <ArrowDown />
                </IconButton>
                <IconButton
                  label={t('Remove')}
                  className="hover:text-destructive"
                  onClick={() => {
                    arr.splice(i, 1);
                    onChange();
                  }}
                >
                  <X />
                </IconButton>
              </span>
            </div>
            <FieldsForm fields={field.fields || []} values={item} onChange={onChange} compact />
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => {
          const entry = applyDefaults(field.fields || [], {}, mt);
          for (const k in entry) entry[k] ??= '';
          arr.push(entry);
          onChange();
        }}
      >
        <Plus />
        {noPlus(t('+ Add {item}', { item: itemLabel }))}
      </Button>
      {field.help && <p className="text-xs text-muted-foreground">{t(field.help)}</p>}
    </div>
  );
}
