import type { ComponentType } from 'react';

export type ToolFormProps = {
  run: (input: Record<string, unknown>) => void;
  running: boolean;
};

export type ToolResultProps = {
  value: unknown;
};

export type ToolFormDef = {
  Form: ComponentType<ToolFormProps>;
  Result: ComponentType<ToolResultProps>;
};
