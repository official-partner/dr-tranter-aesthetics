import { useState, type ReactNode } from 'react';
import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';
import { REMOTE_SCHEMA_LIMITS } from '../../../shared/properties/cmsRemoteSchema';
import AutoTextarea from '../../ui/AutoTextarea';
import type { Attr } from '../../../shared/page/pageNodeTypes';
import { CodeAccess } from '../../ui/CodeAccess';
import { BracesIcon, DropletIcon, FieldSwitchIcon, TextIcon } from '../../ui/Icons';
import { CmsColorInput } from './CmsColorInput';
import { useTranslate } from '../../lib/i18n/useTranslate';
import { CSS_COLOR } from './cmsSchema';
import PropField from '../props/PropField';
import PropTip from '../props/PropTip';
import { PropHoverPreviewContext, PropValuePolicyContext } from '../props/propValuePolicy';
import { suggestedOptions } from './cmsSuggestions';
import { videoLinkOf } from '../../../shared/properties/linkPreview';
import { VideoLinkCard } from './VideoLinkCard';
import { CAPTION_LABEL_FOR } from '../../ui/captionLabel';

export type CmsScalar = string | number | boolean;
export type CmsScalarKind = 'string' | 'text' | 'number' | 'boolean';

export function CmsPropField(props: {
  readonly name: string;
  readonly help: string;
  readonly kind: CmsScalarKind;
  readonly options: readonly string[];
  readonly value: CmsScalar | undefined;
  readonly onChange: (value: CmsScalar | undefined) => void;
}) {
  const { kind, value } = props;
  const text = value === undefined ? undefined : String(value);
  const suggested = kind === 'string' ? suggestedOptions(props.name, text) : [];
  const options = props.options.length > 0 ? props.options : suggested;
  assert(options.length <= 256, 'A CMS field offers a dropdown’s worth of choices');
  const type = options.length > 0 ? 'enum' : kind;
  const color = kind === 'string' && options.length === 0 && looksLikeColor(props.name, text);
  if (color) {
    return <CmsColorField {...props} value={text ?? ''} />;
  }
  if (text !== undefined && text.length > LIMITS.attrCharsMax) {
    return <CmsLongText {...props} value={text} />;
  }
  if (kind === 'boolean') {
    return (
      <CmsFieldFrame
        name={props.name}
        help={props.help}
        icon={<FieldSwitchIcon size={12} />}
        set={value === true}
      >
        <CmsToggle on={value === true} onChange={(next) => props.onChange(next)} />
      </CmsFieldFrame>
    );
  }
  const video = kind === 'string' && text !== undefined ? videoLinkOf(text) : undefined;
  return (
    <PropValuePolicyContext.Provider value="defaults">
      <CodeAccess.Provider value={false}>
        <PropHoverPreviewContext.Provider value={false}>
          <PropField
            field={{
              name: props.name,
              type,
              optional: true,
              ...(options.length > 0 ? { options } : {}),
              ...(props.help ? { doc: props.help } : {}),
            }}
            value={toAttr(kind, value)}
            onChange={(next) => {
              if (kind === 'number' && partialNumber(next)) {
                return;
              }
              props.onChange(fromAttr(kind, next));
            }}
          />
          {video && <VideoLinkCard link={video} onRemove={() => props.onChange(undefined)} />}
        </PropHoverPreviewContext.Provider>
      </CodeAccess.Provider>
    </PropValuePolicyContext.Provider>
  );
}

function CmsColorField(props: {
  readonly name: string;
  readonly help: string;
  readonly value: string;
  readonly onChange: (value: CmsScalar | undefined) => void;
}) {
  const translate = useTranslate();
  const [plain, setPlain] = useState(false);
  const change = (next: string) => props.onChange(next === '' ? undefined : next);
  return (
    <CmsFieldFrame
      name={props.name}
      help={props.help}
      icon={<DropletIcon size={12} />}
      set={props.value !== ''}
      plain={{ on: plain, onToggle: () => setPlain(!plain), useTitle: translate('cms.prop.useColourPicker') }}
    >
      {plain ? (
        <input value={props.value} onChange={(event) => change(event.target.value)} />
      ) : (
        <CmsColorInput value={props.value} label={props.name} onChange={change} />
      )}
    </CmsFieldFrame>
  );
}

function CmsLongText(props: {
  readonly name: string;
  readonly help: string;
  readonly value: string;
  readonly onChange: (value: CmsScalar | undefined) => void;
}) {
  assert(props.value.length > LIMITS.attrCharsMax, 'Long CMS text is past a prop field');
  assert(LIMITS.attrCharsMax < REMOTE_SCHEMA_LIMITS.valueCharsMax, 'A CMS value holds more than an attribute');
  return (
    <CmsFieldFrame name={props.name} help={props.help} icon={<TextIcon size={12} />} set>
      <AutoTextarea
        value={props.value}
        minRows={3}
        maxLength={REMOTE_SCHEMA_LIMITS.valueCharsMax}
        onChange={(event) => props.onChange(event.target.value === '' ? undefined : event.target.value)}
      />
    </CmsFieldFrame>
  );
}

function looksLikeColor(name: string, text: string | undefined): boolean {
  if (text !== undefined && text !== '') {
    return CSS_COLOR.test(text.trim());
  }
  return /colou?r$/i.test(name.trim());
}

export function CmsToggle(props: { readonly on: boolean; readonly onChange: (on: boolean) => void }) {
  const translate = useTranslate();
  return (
    <button type="button" role="switch" aria-checked={props.on} className={`cms-toggle ${props.on ? 'on' : ''}`} onClick={() => props.onChange(!props.on)}>
      <span className="cms-toggle-knob" />
      <span className="cms-toggle-label">{props.on ? translate('cms.toggle.on') : translate('cms.toggle.off')}</span>
    </button>
  );
}

export function CmsFieldFrame(props: {
  readonly name: string;
  readonly help: string;
  readonly icon: ReactNode;
  readonly set: boolean;
  readonly plain?: {
    readonly on: boolean;
    readonly onToggle: () => void;
    readonly useTitle: string;
  };
  readonly children: ReactNode;
}) {
  const { plain } = props;
  const translate = useTranslate();
  return (
    <div className="props-field">
      <label htmlFor={CAPTION_LABEL_FOR} onClick={(event) => event.preventDefault()}>
        <span className={`prop-label${props.set ? ' set' : ''}`}>
          <span className="prop-label-icon">{props.icon}</span>
          {props.name}
        </span>
        <PropTip {...(props.help ? { text: props.help } : {})} />
        {plain && (
          <button
            type="button"
            className={`prop-expr-toggle${plain.on ? ' on' : ''}`}
            title={plain.on ? plain.useTitle : translate('cms.prop.typeAny')}
            aria-pressed={plain.on}
            onClick={plain.onToggle}
          >
            <BracesIcon size={12} />
          </button>
        )}
      </label>
      {props.children}
    </div>
  );
}

function toAttr(kind: CmsScalarKind, value: CmsScalar | undefined): Attr | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (kind === 'number' || kind === 'boolean') {
    return { type: 'expr', value: String(value) };
  }
  return { type: 'string', value: String(value) };
}

function fromAttr(kind: CmsScalarKind, attr: Attr | undefined): CmsScalar | undefined {
  if (attr === undefined || attr.type === 'bare' || attr.type === 'spread') {
    return undefined;
  }
  const text = attr.value;
  if (kind === 'boolean') {
    return text === 'true';
  }
  if (kind === 'number') {
    const number = Number(text);
    return text.trim() === '' || !Number.isFinite(number) ? undefined : number;
  }
  return text === '' ? undefined : text;
}

function partialNumber(attr: Attr | undefined): boolean {
  if (attr === undefined || attr.type === 'bare' || attr.type === 'spread') {
    return false;
  }
  return attr.value.trim() !== '' && !Number.isFinite(Number(attr.value));
}
