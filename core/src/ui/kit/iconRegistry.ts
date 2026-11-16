import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Asterisk,
  AudioWaveform,
  Braces,
  Brain,
  Check,
  CircleAlert,
  CircleCheck,
  CircleDot,
  ClipboardList,
  Code,
  Diamond,
  Eye,
  FileSpreadsheet,
  FileText,
  HardDrive,
  Layers,
  Orbit,
  Package,
  Printer,
  RotateCcw,
  Shuffle,
  SlidersHorizontal,
  SquareX,
  Tag,
  Truck,
  Wallet,
  Waves,
  Wind,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';

/**
 * String → icon registry.
 *
 * Fixture rows name their icon as a string because that is what an API returns;
 * this is the single place that resolves one, so an unknown name degrades to a
 * neutral glyph instead of crashing a table row.
 */
const REGISTRY: Readonly<Record<string, LucideIcon>> = {
  'arrow-down': ArrowDown,
  'arrow-left-right': ArrowLeftRight,
  'arrow-up': ArrowUp,
  check: Check,
  'circle-dot': CircleDot,
  'clipboard-list': ClipboardList,
  'file-spreadsheet': FileSpreadsheet,
  'file-text': FileText,
  layers: Layers,
  package: Package,
  printer: Printer,
  'rotate-ccw': RotateCcw,
  tag: Tag,
  truck: Truck,
  wallet: Wallet,
  x: X,

  /* Settings: provider registry cards. */
  orbit: Orbit,
  asterisk: Asterisk,
  diamond: Diamond,
  shuffle: Shuffle,
  waves: Waves,
  wind: Wind,
  'square-x': SquareX,
  'hard-drive': HardDrive,
  code: Code,

  /* Settings: capability chips and the sync log. */
  'audio-waveform': AudioWaveform,
  braces: Braces,
  eye: Eye,
  brain: Brain,
  wrench: Wrench,
  'sliders-horizontal': SlidersHorizontal,
  'circle-check': CircleCheck,
  'circle-alert': CircleAlert,
};

export function resolveIcon(name: string): LucideIcon {
  return REGISTRY[name] ?? CircleDot;
}
