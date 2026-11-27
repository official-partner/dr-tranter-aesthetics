import type { ScanComponent } from '../../../shared/properties/projectScan';
import type { Result } from '../../../shared/core/result';
import type { ComponentOpError, ComponentOpTarget } from '../../../shared/properties/componentOps';
import type { ComponentRenameRequest, ComponentRenameSummary } from '../../../shared/properties/componentRename';

export interface ManagedItem extends ComponentOpTarget {
  readonly name: string;
  readonly files: number;
}

export interface RenameHost {
  readonly roots: readonly string[];
  readonly plan: (request: ComponentRenameRequest) => Promise<Result<ComponentRenameSummary, ComponentOpError>>;
  readonly apply: (component: ScanComponent, request: ComponentRenameRequest, change: 'rename' | 'move' | 'both') => Promise<boolean>;
}

export interface PaletteManagement {
  readonly rename?: RenameHost | undefined;
  readonly editSettings: (component: ScanComponent) => void;
  readonly duplicate: (item: ManagedItem) => void;
  readonly remove: (item: ManagedItem) => void;
}
