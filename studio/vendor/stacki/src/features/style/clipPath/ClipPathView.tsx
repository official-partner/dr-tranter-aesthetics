import { centralIcon } from '../../../ui/central/CentralIcon';
import {
  chevronDown as centralChevronDown,
  help as centralHelp,
  arrowRotateCounterClockwise as centralArrowRotateCounterClockwise,
} from '../../../ui/central/centralGeometry';
import Popup from '../../../ui/Popup';

const HelpGlyph = centralIcon(centralHelp, 12);

const ChevronDownGlyph = centralIcon(centralChevronDown, 12);

const ResetGlyph = centralIcon(centralArrowRotateCounterClockwise, 12);

import { createPortal } from 'react-dom';
import { useTranslate } from '../../../lib/i18n/useTranslate';
import { CodeEditor } from '../components/CssCodeEditor';
import SegmentedControl from '../../../ui/SegmentedControl';
import ClassPicker from '../components/ClassPicker';
import { type ShapeFitMode, type ShapeScaleOptionOverrides } from './clipPathTypes';
import {
  BREAKPOINT_LABEL_KEYS,
  CLIP_PATH_CODE_ID,
  presetLabel,
  SHAPE_SCALE_VARIABLE_PLACEHOLDER,
  SHAPE_OFFSET_LEFT_VARIABLE_PLACEHOLDER,
  SHAPE_OFFSET_TOP_VARIABLE_PLACEHOLDER,
} from './clipPathConstants';
import { formatShapeVariableField } from './clipPathMeasure';
import VariableConnect from '../VariableConnect';
import { PRESETS, PRESET_NAMES } from './clipPathFormat';
import { presetOptionId } from './clipPathShortcuts';
import { BreakpointIcon, PresetIcon } from './ClipPathIcons';
import { type EditorProps } from './clipPathWriteActions';
import { ShortcutHelpGroups, ClipPathCanvas } from './ClipPathCanvas';

export function ClipPathView({ editor }: EditorProps) {
  const translate = useTranslate();
  const { shortcutHelpPortalTarget, hideClassPicker, codeValue } = editor;
  const { selectedCodeTokenHighlights, onCodeChange, onCodeSelectionChange } = editor;
  return (
    <div className="clip-path_component">
      {shortcutHelpPortalTarget ? createPortal(<ShortcutHelpControl editor={editor} />, shortcutHelpPortalTarget) : undefined}
      {hideClassPicker ? undefined : <ClassTagsControl editor={editor} />}
      <PresetControl editor={editor} />
      <ClipPathCanvas editor={editor} />
      <ShapeFitControl editor={editor} />
      <ShapeScaleVariableControl editor={editor} />

      <CodeEditor
        id={CLIP_PATH_CODE_ID}
        className="clip-path_code"
        value={codeValue}
        language="css"
        ariaLabel={translate('styleModel.clipPath.codeLabel')}
        variables={{ kind: 'value', prop: 'clip-path' }}
        tokenHighlights={selectedCodeTokenHighlights}
        onChange={onCodeChange}
        onSelectionChange={onCodeSelectionChange}
      />
    </div>
  );
}

export function ClassTagsControl({ editor }: EditorProps) {
  const translate = useTranslate();
  const { elementClassNames, selectedClassNames, handleClassSelectionChange } = editor;
  const { selectedSelector } = editor;
  if (!elementClassNames.length) {
    return undefined;
  }
  return (
    <ClassPicker
      className="clip-path_classes"
      tokens={elementClassNames.map((name) => ({ name, kind: 'class' }))}
      selected={selectedClassNames}
      onChange={handleClassSelectionChange}
      tagTitle={(token, isActive) =>
        selectedSelector && isActive
          ? translate('styleModel.clipPath.tagEditing', { selector: selectedSelector })
          : translate('styleModel.clipPath.tagEdit', { name: token.name })
      }
    />
  );
}

export function PresetControl({ editor }: EditorProps) {
  const { isPresetOpen, isClipPathLabelMenuOpen, clipPathStyleOrigin } = editor;
  const { isShortcutHelpOpen } = editor;
  return (
    <div
      className={[
        'clip-path_control-row',
        isPresetOpen ? 'is-dropdown-open' : '',
        isClipPathLabelMenuOpen && clipPathStyleOrigin !== 'none' ? 'is-label-menu-open' : '',
        isShortcutHelpOpen ? 'is-shortcuts-open' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <ClipPathLabel editor={editor} />
      <div className="clip-path_control-field">
        <PresetDropdown editor={editor} />
      </div>
    </div>
  );
}

export function ClipPathLabel({ editor }: EditorProps) {
  const translate = useTranslate();
  const { clipPathLabelRef, clipPathStyleOrigin, clipPathLabelClassName } = editor;
  const { isClipPathLabelMenuOpen, onClipPathLabelClick, resetCurrentBreakpointClipPath } = editor;
  return (
    <div className="clip-path_control-label-wrap" ref={clipPathLabelRef}>
      {clipPathStyleOrigin !== 'none' ? (
        <button
          id="clip-path_preset-label"
          type="button"
          className={`${clipPathLabelClassName} clip-path_control-label-button`}
          aria-haspopup={clipPathStyleOrigin === 'current' ? 'menu' : 'dialog'}
          aria-expanded={isClipPathLabelMenuOpen}
          onClick={onClipPathLabelClick}
        >
          {translate('styleModel.clipPath.label')}
        </button>
      ) : (
        <span className={clipPathLabelClassName} id="clip-path_preset-label">
          {translate('styleModel.clipPath.label')}
        </span>
      )}
      {isClipPathLabelMenuOpen && clipPathStyleOrigin === 'current' ? (
        <Popup mode="popover" portal={false} onClose={() => editor.setIsClipPathLabelMenuOpen(false)} className="clip-path_label-menu" role="menu">
          <button type="button" className="clip-path_label-menu-item" role="menuitem" onClick={() => void resetCurrentBreakpointClipPath()}>
            <ResetGlyph className="clip-path_label-menu-icon" />
            <span>{translate('ui.reset')}</span>
            <span className="clip-path_label-menu-shortcut">{translate('styleModel.shared.optionClick')}</span>
          </button>
        </Popup>
      ) : undefined}
      {isClipPathLabelMenuOpen && clipPathStyleOrigin === 'inherited' ? <ClipPathSourceMenu editor={editor} /> : undefined}
    </div>
  );
}

export function ClipPathSourceMenu({ editor }: EditorProps) {
  const translate = useTranslate();
  const { clipPathSourceBreakpoint, clipPathSourceSelector, appliedClassName } = editor;
  return (
    <Popup
      mode="popover"
      portal={false}
      onClose={() => editor.setIsClipPathLabelMenuOpen(false)}
      className="clip-path_label-menu clip-path_source-menu"
      role="dialog"
      label={translate('styleModel.clipPath.sourceLabel')}
    >
      <span className="clip-path_source-title">{translate('styleModel.shared.valueComesFrom')}</span>
      <div className="clip-path_source-row">
        {clipPathSourceBreakpoint ? (
          <span className="clip-path_source-breakpoint" title={translate(BREAKPOINT_LABEL_KEYS[clipPathSourceBreakpoint])}>
            <BreakpointIcon breakpoint={clipPathSourceBreakpoint} />
            {translate(BREAKPOINT_LABEL_KEYS[clipPathSourceBreakpoint])}
          </span>
        ) : undefined}
        {(clipPathSourceSelector.length ? clipPathSourceSelector : appliedClassName ? [appliedClassName] : []).map((name) => (
          <span className="clip-path_source-class" key={name}>
            {name}
          </span>
        ))}
      </div>
    </Popup>
  );
}

export function PresetDropdown({ editor }: EditorProps) {
  const translate = useTranslate();
  const { presetDropdownRef, presetButtonRef, isPresetOpen, closePresetDropdown } = editor;
  const { setIsShortcutHelpOpen, openPresetDropdown, onPresetButtonKeyDown } = editor;
  const { selectedPresetShape, activePreset } = editor;
  return (
    <div className="clip-path_preset" ref={presetDropdownRef}>
      <button
        id="clip-path_preset-button"
        ref={presetButtonRef}
        type="button"
        className="clip-path_preset-button"
        aria-haspopup="listbox"
        aria-expanded={isPresetOpen}
        aria-controls="clip-path_preset-listbox"
        aria-labelledby="clip-path_preset-label clip-path_preset-button"
        onClick={() => {
          if (isPresetOpen) {
            closePresetDropdown();
          } else {
            setIsShortcutHelpOpen(false);
            openPresetDropdown();
          }
        }}
        onKeyDown={onPresetButtonKeyDown}
      >
        <span className="clip-path_preset-value">
          <PresetIcon shape={selectedPresetShape} />
          <span className="clip-path_preset-name">{presetLabel(activePreset, translate)}</span>
        </span>
        <ChevronDownGlyph className="clip-path_preset-chevron" />
      </button>

      {isPresetOpen ? <PresetList editor={editor} /> : undefined}
    </div>
  );
}

export function PresetList({ editor }: EditorProps) {
  const translate = useTranslate();
  const { presetListRef, activePresetOptionId, onPresetListKeyDown, activePreset } = editor;
  const { activePresetIndex, setActivePresetIndex, choosePreset } = editor;
  return (
    <Popup
      mode="popover"
      portal={false}
      onClose={editor.closePresetDropdown}
      anchor={editor.presetButtonRef.current ?? undefined}
      id="clip-path_preset-listbox"
      ref={presetListRef}
      className="clip-path_preset-list"
      role="listbox"
      tabIndex={-1}
      labelledBy="clip-path_preset-label"
      aria-activedescendant={activePresetOptionId}
      onKeyDown={onPresetListKeyDown}
    >
      {PRESET_NAMES.map((name, index) => {
        const optionShape = PRESETS[name];
        if (!optionShape) {
          return undefined;
        }
        const isSelected = activePreset === name;

        return (
          <div
            key={name}
            id={presetOptionId(name)}
            className={['clip-path_preset-option', index === activePresetIndex ? 'is-active' : '', isSelected ? 'is-selected' : ''].filter(Boolean).join(' ')}
            role="option"
            aria-selected={isSelected}
            onMouseEnter={() => setActivePresetIndex(index)}
            onClick={() => choosePreset(name)}
          >
            <PresetIcon shape={optionShape} />
            <span className="clip-path_preset-name">{presetLabel(name, translate)}</span>
          </div>
        );
      })}
    </Popup>
  );
}

export function ShapeFitControl({ editor }: EditorProps) {
  const translate = useTranslate();
  const { activePreset, shapeFitMode, setShapeFitModeFromControl } = editor;
  if (activePreset !== 'Shape') {
    return undefined;
  }
  return (
    <div className="clip-path_control-row clip-path_control-row--with-help">
      <label className="clip-path_control-label" id="clip-path_shape-fit-label">
        {translate('styleModel.clipPath.fit')}
      </label>
      <div className="clip-path_control-field">
        <SegmentedControl<ShapeFitMode>
          ariaLabel={translate('styleModel.clipPath.fit')}
          value={shapeFitMode}
          onChange={setShapeFitModeFromControl}
          options={[
            { value: 'contain', label: translate('styleModel.clipPath.fit.scale') },
            { value: 'stretch', label: translate('styleModel.clipPath.fit.stretch') },
          ]}
        />
      </div>
      {shapeFitMode === 'contain' ? (
        <p className="clip-path_control-help">
          <HelpGlyph className="clip-path_control-help-icon" />
          <span>{translate('styleModel.clipPath.fit.containerHint', { code: 'container-type: size;' })}</span>
        </p>
      ) : undefined}
    </div>
  );
}

export function ShapeVariableLabel({ id, text, tip }: { id: string; text: string; tip: string }) {
  return (
    <div className="clip-path_label-with-help">
      <label className="clip-path_control-label" id={id}>
        {text}
      </label>
      <span className="clip-path_label-help">
        <button type="button" className="clip-path_label-help-button" aria-label={tip}>
          <HelpGlyph className="clip-path_label-help-icon" />
        </button>
        <span className="clip-path_label-help-tip" aria-hidden="true">
          {tip}
        </span>
      </span>
    </div>
  );
}

export function ShapeVariableInput({
  id,
  labelId,
  label,
  prop,
  value,
  placeholder,
  apply,
}: {
  id: string;
  labelId: string;
  label: string;
  prop: string;
  value: string;
  placeholder: string;
  apply: (fieldText: string) => void;
}) {
  const translate = useTranslate();
  return (
    <div className="clip-path_control-field clip-path_variable-field">
      <VariableConnect
        ariaLabel={translate('styleModel.shared.connectVariable', { label })}
        prop={prop}
        onPick={(binding) => apply(formatShapeVariableField(binding))}
      >
        <input
          id={id}
          className="u-input clip-path_variable-input"
          value={value}
          onChange={(event) => apply(event.target.value)}
          onBlur={(event) => {
            const formatted = formatShapeVariableField(event.target.value);
            if (event.target.value !== formatted) {
              apply(formatted);
            }
          }}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          aria-labelledby={labelId}
        />
      </VariableConnect>
    </div>
  );
}

export function ShapeScaleVariableControl({ editor }: EditorProps) {
  const translate = useTranslate();
  const { activePreset, shapeFitMode, shapeScaleVariableName } = editor;
  const { setShapeScaleOptionsFromControl, currentShapeScaleOptions } = editor;
  const { shapeOffsetLeftVariableName, shapeOffsetTopVariableName } = editor;
  if (activePreset !== 'Shape' || shapeFitMode !== 'contain') {
    return undefined;
  }
  const apply = (overrides: ShapeScaleOptionOverrides) => setShapeScaleOptionsFromControl(currentShapeScaleOptions(overrides));
  return (
    <>
      <div className="clip-path_control-row">
        <ShapeVariableLabel
          id="clip-path_shape-variable-label"
          text={translate('styleModel.clipPath.variable.size')}
          tip={translate('styleModel.clipPath.variable.sizeTip')}
        />
        <ShapeVariableInput
          id="clip-path_shape-variable-input"
          labelId="clip-path_shape-variable-label"
          label={translate('styleModel.clipPath.variable.size')}
          prop="width"
          value={shapeScaleVariableName}
          placeholder={SHAPE_SCALE_VARIABLE_PLACEHOLDER}
          apply={(name) => apply({ variableName: name })}
        />
      </div>
      <div className="clip-path_control-row">
        <ShapeVariableLabel
          id="clip-path_shape-offset-left-label"
          text={translate('styleModel.clipPath.variable.offsetX')}
          tip={translate('styleModel.clipPath.variable.offsetXTip')}
        />
        <ShapeVariableInput
          id="clip-path_shape-offset-left-input"
          labelId="clip-path_shape-offset-left-label"
          label={translate('styleModel.clipPath.variable.offsetX')}
          prop="opacity"
          value={shapeOffsetLeftVariableName}
          placeholder={SHAPE_OFFSET_LEFT_VARIABLE_PLACEHOLDER}
          apply={(name) => apply({ offsetLeftVariableName: name })}
        />
      </div>
      <div className="clip-path_control-row">
        <ShapeVariableLabel
          id="clip-path_shape-offset-top-label"
          text={translate('styleModel.clipPath.variable.offsetY')}
          tip={translate('styleModel.clipPath.variable.offsetYTip')}
        />
        <ShapeVariableInput
          id="clip-path_shape-offset-top-input"
          labelId="clip-path_shape-offset-top-label"
          label={translate('styleModel.clipPath.variable.offsetY')}
          prop="opacity"
          value={shapeOffsetTopVariableName}
          placeholder={SHAPE_OFFSET_TOP_VARIABLE_PLACEHOLDER}
          apply={(name) => apply({ offsetTopVariableName: name })}
        />
      </div>
    </>
  );
}

export function ShortcutHelpControl({ editor }: EditorProps) {
  const translate = useTranslate();
  const { shortcutHelpRef, isShortcutHelpOpen, closePresetDropdown } = editor;
  const { setIsShortcutHelpOpen, selectedPresetShape, activePreset } = editor;
  return (
    <div className="clip-path_shortcuts" ref={shortcutHelpRef}>
      <button
        type="button"
        className="clip-path_shortcuts-button"
        aria-label={translate('styleModel.clipPath.shortcuts.show')}
        aria-haspopup="dialog"
        aria-expanded={isShortcutHelpOpen}
        aria-controls="clip-path_shortcuts-popover"
        onClick={() => {
          closePresetDropdown();
          setIsShortcutHelpOpen((isOpen) => !isOpen);
        }}
      >
        <svg className="clip-path_shortcuts-icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M6.4 6.2a1.8 1.8 0 1 1 2.9 1.4c-.7.5-1.1.8-1.1 1.8" />
          <path d="M8 11.8h.01" />
        </svg>
      </button>
      {isShortcutHelpOpen ? (
        <Popup
          mode="popover"
          portal={false}
          onClose={() => setIsShortcutHelpOpen(false)}
          id="clip-path_shortcuts-popover"
          className="clip-path_shortcuts-popover"
          role="dialog"
          label={translate('styleModel.clipPath.shortcuts.title')}
        >
          <div className="clip-path_shortcuts-header">
            <span className="clip-path_shortcuts-title">{translate('styleModel.clipPath.shortcuts.heading')}</span>
            <span className="clip-path_shortcuts-preset">
              <PresetIcon shape={selectedPresetShape} />
              <span className="clip-path_shortcuts-preset-name">{presetLabel(activePreset, translate)}</span>
            </span>
          </div>
          <ShortcutHelpGroups editor={editor} />
        </Popup>
      ) : undefined}
    </div>
  );
}
