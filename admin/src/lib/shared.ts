// Typed facade over the plain-ESM modules shared with the server and the mirror.
// They are imported by relative path so Vite bundles them into the admin build.
import * as modules from '../../../public/shared/modules.js';
import * as i18n from '../../../public/shared/i18n.js';

export type Values = Record<string, any>;
export type Translate = (id: string, params?: Record<string, string | number>) => string;

export type Option = { value: string; label: string };

export type Field = {
  key: string;
  label: string;
  type: string;
  default?: unknown;
  options?: Option[];
  min?: number;
  max?: number;
  step?: number;
  help?: string;
  placeholder?: string;
  secret?: boolean;
  showIf?: Record<string, unknown>;
  /** tab in the admin's General view */
  group?: string;
  fields?: Field[];
  itemLabel?: string;
};

export type ModuleType = {
  label: string;
  description: string;
  defaultTitle: string;
  defaultRegion: string;
  fields: Field[];
};

export type Region = { id: string; label: string };

export type Page = {
  id: string;
  name: string;
  duration: number;
  enabled: boolean;
  schedule?: Schedule;
  /** inclusive YYYY-MM-DD, '' = open */
  dateFrom?: string;
  dateTo?: string;
  /** while active, only exclusive pages rotate */
  exclusive?: boolean;
  /** skip when all of its own modules are hidden by their schedules */
  skipEmpty?: boolean;
  /** only rotate while this module has something to show */
  showWhen?: string;
  /** only on these mirrors (general.displays ids), empty = all */
  displays?: string[];
  /** animated background with the current weather */
  ambient?: 'off' | 'subtle' | 'full';
};

export type Module = {
  id: string;
  type: string;
  enabled: boolean;
  title: string;
  pages: string[];
  region: string;
  order: number;
  /** "fill" = use all free space in its column */
  height?: 'auto' | 'fill';
  /** hide while the module has nothing to show (see public/shared/conditions.js) */
  onlyWithContent?: boolean;
  /** shown only while this other module is hidden */
  insteadOf?: string;
  /** own position per page; other pages use region/order */
  placements?: Record<string, { region: string; order: number }>;
  schedule?: Schedule;
  settings: Values;
};

export type Schedule = { enabled: boolean; days: number[]; from: string; to: string };

export type Config = {
  version: number;
  general: Values;
  pages: Page[];
  modules: Module[];
  updatedAt?: string | null;
};

export type Build = {
  version: string;
  commit: string | null;
  shortCommit: string | null;
  branch: string | null;
  builtAt: string | null;
  source: 'release' | 'local' | 'dev';
  commitUrl: string | null;
};
export type Me = { name: string; email?: string; method: 'local' | 'oidc'; version: string; build?: Build };

export const MODULE_TYPES = modules.MODULE_TYPES as unknown as Record<string, ModuleType>;
export const GENERAL_FIELDS = modules.GENERAL_FIELDS as unknown as Field[];
export const GENERAL_GROUPS = modules.GENERAL_GROUPS as unknown as { id: string; label: string }[];
export const REGIONS = modules.REGIONS as unknown as Region[];

export const defaultModule = modules.defaultModule as unknown as (
  type: string,
  extra?: Partial<Module>,
  locale?: string,
) => Module;
export const applyDefaults = modules.applyDefaults as unknown as (fields: Field[], values?: Values, t?: Translate) => Values;
export const uid = modules.uid as unknown as (prefix?: string) => string;

export const LANGUAGES = i18n.LANGUAGES as unknown as Option[];
export const langOf = i18n.langOf as unknown as (locale?: string | null) => string;
export const translator = i18n.translator as unknown as (lang: string) => Translate;
