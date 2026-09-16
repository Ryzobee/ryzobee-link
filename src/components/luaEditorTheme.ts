import type { editor } from 'monaco-editor/editor';

export function createLuaEditorTheme(styles: Pick<CSSStyleDeclaration, 'getPropertyValue'>): editor.IStandaloneThemeData {
  const color = (name: string) => {
    // CSS minification preserves #RGB in custom properties. Monaco token
    // colors require six digits; alpha suffixes below also need full RGB.
    const value = styles.getPropertyValue('--ryzo-' + name).trim();
    return value.replace(/^#([\da-f])([\da-f])([\da-f])$/i, '#$1$1$2$2$3$3').toUpperCase();
  };
  const foreground = (name: string) => color(name).slice(1);
  return {
    // Base token subtypes (e.g. number.hex) would otherwise override our palette.
    base: 'vs-dark', inherit: false,
    rules: [
      { token: '', foreground: foreground('text-body') },
      { token: 'keyword', foreground: foreground('orange') },
      { token: 'string', foreground: foreground('text-primary') },
      { token: 'string.escape', foreground: foreground('orange') },
      { token: 'string.invalid', foreground: foreground('error') },
      { token: 'string.escape.invalid', foreground: foreground('error') },
      { token: 'comment', foreground: foreground('text-secondary') },
      { token: 'number', foreground: foreground('orange') },
      { token: 'delimiter', foreground: foreground('text-secondary') },
      { token: 'identifier', foreground: foreground('text-body') },
      { token: 'type', foreground: foreground('text-primary') },
      { token: 'invalid', foreground: foreground('error') },
    ],
    colors: {
      'foreground': color('text-body'), 'descriptionForeground': color('text-secondary'),
      'disabledForeground': color('text-disabled'), 'errorForeground': color('error'), 'focusBorder': color('orange'),
      'editor.background': color('bg'), 'editor.foreground': color('text-body'),
      'editorLineNumber.foreground': color('text-secondary'), 'editorLineNumber.activeForeground': color('orange'),
      'editor.lineHighlightBackground': color('surface'), 'editor.lineHighlightBorder': color('surface'),
      'editorCursor.foreground': color('orange'), 'editor.selectionBackground': color('orange') + '33',
      'editor.inactiveSelectionBackground': color('text-primary') + '1A',
      'editor.selectionHighlightBackground': color('orange') + '22',
      'editor.wordHighlightBackground': color('text-primary') + '1A',
      'editor.wordHighlightStrongBackground': color('orange') + '22',
      'editor.findMatchBackground': color('orange') + '55', 'editor.findMatchBorder': color('orange'),
      'editor.findMatchHighlightBackground': color('orange') + '22',
      'editorIndentGuide.background1': color('border'), 'editorIndentGuide.activeBackground1': color('text-secondary'),
      'editorWhitespace.foreground': color('border'), 'editorGutter.background': color('bg'),
      'editorGutter.foldingControlForeground': color('text-secondary'),
      'editorBracketMatch.background': color('surface-secondary'), 'editorBracketMatch.border': color('orange'),
      'editorBracketHighlight.foreground1': color('text-secondary'), 'editorBracketHighlight.foreground2': color('text-secondary'),
      'editorBracketHighlight.foreground3': color('text-secondary'), 'editorBracketHighlight.foreground4': color('text-secondary'),
      'editorBracketHighlight.foreground5': color('text-secondary'), 'editorBracketHighlight.foreground6': color('text-secondary'),
      'editorBracketHighlight.unexpectedBracket.foreground': color('error'),
      'editorError.foreground': color('error'), 'editorWarning.foreground': color('warning'),
      'editorInfo.foreground': color('info'), 'editorHint.foreground': color('text-secondary'),
      'editorLink.activeForeground': color('info'), 'editorOverviewRuler.border': color('border'),
      'editorWidget.background': color('surface'), 'editorWidget.foreground': color('text-body'), 'editorWidget.border': color('border'),
      'editorSuggestWidget.background': color('surface'), 'editorSuggestWidget.foreground': color('text-body'),
      'editorSuggestWidget.border': color('border'), 'editorSuggestWidget.selectedBackground': color('surface-secondary'),
      'editorSuggestWidget.selectedForeground': color('text-primary'), 'editorSuggestWidget.highlightForeground': color('orange'),
      'editorHoverWidget.background': color('surface'), 'editorHoverWidget.foreground': color('text-body'),
      'editorHoverWidget.border': color('border'), 'editorHoverWidget.statusBarBackground': color('surface-secondary'),
      'scrollbarSlider.background': color('text-disabled') + '66', 'scrollbarSlider.hoverBackground': color('gray-500') + '88',
      'scrollbarSlider.activeBackground': color('text-secondary') + 'AA', 'scrollbar.shadow': color('black'),
      'input.background': color('bg'), 'input.foreground': color('text-primary'), 'input.border': color('border'),
      'input.placeholderForeground': color('text-secondary'), 'inputOption.activeBorder': color('orange'),
      'inputOption.activeBackground': color('orange') + '33', 'inputOption.activeForeground': color('text-primary'),
      'list.activeSelectionBackground': color('surface-secondary'), 'list.activeSelectionForeground': color('text-primary'),
      'list.focusBackground': color('surface-secondary'), 'list.focusForeground': color('text-primary'),
      'list.focusOutline': color('orange'), 'list.hoverBackground': color('surface-secondary'),
      'list.highlightForeground': color('orange'), 'menu.background': color('surface'), 'menu.foreground': color('text-body'),
      'menu.selectionBackground': color('surface-secondary'), 'menu.selectionForeground': color('text-primary'),
      'menu.border': color('border'), 'menu.separatorBackground': color('border'),
      'button.background': color('orange'), 'button.foreground': color('black'), 'button.hoverBackground': color('text-primary'),
    },
  };
}
