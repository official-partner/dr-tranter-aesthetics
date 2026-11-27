import { centralIcon } from './central/CentralIcon';
import {
  bold as centralBold,
  bulletList as centralBulletList,
  clearFormat as centralClearFormat,
  code as centralCode,
  divider as centralDivider,
  italic as centralItalic,
  link as centralLink,
  numberList as centralNumberList,
  quote as centralQuote,
  redo as centralRedo,
  strike as centralStrike,
  subscript as centralSubscript,
  superscript as centralSuperscript,
  underline as centralUnderline,
  undo as centralUndo,
  unlink as centralUnlink,
} from './central/centralGeometry';

export const BoldIcon = centralIcon(centralBold);

export const ItalicIcon = centralIcon(centralItalic);

export const UnderlineIcon = centralIcon(centralUnderline);

export const StrikeIcon = centralIcon(centralStrike);

export const SuperscriptIcon = centralIcon(centralSuperscript);

export const SubscriptIcon = centralIcon(centralSubscript);

export const InlineCodeIcon = centralIcon(centralCode);

export const LinkIcon = centralIcon(centralLink);

export const UnlinkIcon = centralIcon(centralUnlink);

export const BulletListIcon = centralIcon(centralBulletList);

export const NumberListIcon = centralIcon(centralNumberList);

export const QuoteIcon = centralIcon(centralQuote);

export const RuleIcon = centralIcon(centralDivider);

export const ClearFormatIcon = centralIcon(centralClearFormat);

export const UndoIcon = centralIcon(centralUndo);

export const RedoIcon = centralIcon(centralRedo);
