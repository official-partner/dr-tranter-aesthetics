import type { AppSummary } from '../../../shared/properties/apps';
import { isReservedShortcut } from '../../../shared/properties/appShortcuts';
import { assert } from '../../../shared/core/assert';
import type { Translator } from '../../../shared/properties/i18n/messageRef';
import { useTranslate } from '../../lib/i18n/useTranslate';
import { ShortcutRecorder } from '../../ui/ShortcutRecorder';
import { AppDetailsItem, AppDetailsList, AppDetailsSection } from './AppDetailsLayout';
import {
  commandShortcutHint,
  platformShortcutLabel,
  rebindCommand,
  rebindFor,
  shortcutHolder,
  shortcutPlatform,
  useAppCommands,
  type BoundCommand,
} from './appCommands';

export function AppCommandSettings({ app, admin }: { readonly app: AppSummary; readonly admin: boolean }) {
  const translate = useTranslate();
  const bound = useAppCommands();
  const commands = bound.filter((entry) => entry.app.manifest.id === app.manifest.id);
  if (commands.length === 0) {
    return undefined;
  }
  assert(
    commands.every((entry) => entry.command.title.length > 0),
    'Every command has a title',
  );
  const platform = shortcutPlatform();
  const hint = commandShortcutHint(platform, translate);
  return (
    <AppDetailsSection title={translate('apps.commands.title')} hint={translate('apps.commands.hint')}>
      <AppDetailsList label={translate('apps.commands.listLabel', { name: app.manifest.name })}>
        {commands.map((entry) => {
          const appId = app.manifest.id;
          const commandId = entry.command.id;
          const held = heldNote(entry, translate);
          return (
            <AppDetailsItem key={commandId} label={entry.command.title} {...(held === undefined ? {} : { hint: held, tone: 'warning' as const })}>
              {admin ? (
                <ShortcutRecorder
                  ariaLabel={translate('apps.commands.shortcutFor', { title: entry.command.title })}
                  value={wantedShortcut(entry)}
                  emptyLabel={translate('apps.commands.none')}
                  platform={platform}
                  format={platformShortcutLabel}
                  hint={hint}
                  accepts={isReservedShortcut}
                  conflict={(shortcut) => shortcutHolder(bound, appId, commandId, shortcut, translate)}
                  reset={
                    entry.rebind === undefined
                      ? undefined
                      : { label: translate('apps.commands.useOwnKey'), onReset: () => rebindCommand(appId, commandId, undefined) }
                  }
                  onClear={() => rebindCommand(appId, commandId, rebindFor(entry.command, undefined))}
                  onChange={(shortcut) => {
                    assert(isReservedShortcut(shortcut), 'A recorded command key is in the reserved range');
                    rebindCommand(appId, commandId, rebindFor(entry.command, shortcut));
                  }}
                />
              ) : (
                <span className="apps-details-shortcut">{shortcutText(entry, translate)}</span>
              )}
            </AppDetailsItem>
          );
        })}
      </AppDetailsList>
    </AppDetailsSection>
  );
}

function wantedShortcut({ shortcut, inUse }: BoundCommand): string | undefined {
  return inUse === undefined ? shortcut : inUse.shortcut;
}

function heldNote({ inUse }: BoundCommand, translate: Translator): string | undefined {
  if (inUse === undefined) {
    return undefined;
  }
  assert(inUse.holder.length > 0, 'A key in use names its holder');
  return translate('apps.commands.inUse', { shortcut: platformShortcutLabel(inUse.shortcut), holder: inUse.holder });
}

function shortcutText(entry: BoundCommand, translate: Translator): string {
  const wanted = wantedShortcut(entry);
  return wanted === undefined ? translate('apps.commands.none') : platformShortcutLabel(wanted);
}
