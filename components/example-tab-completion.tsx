'use client';
import { useEffect } from 'react';

/** Complete actual examples, not instructional placeholders or credentials. */
export function ExampleTabCompletion() {
  useEffect(() => {
    function complete(event: KeyboardEvent) {
      if (event.key !== 'Tab' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.isComposing || event.repeat || event.defaultPrevented) return;
      const field = event.target;
      if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) || field.disabled || field.readOnly || field.value.length) return;
      if (field instanceof HTMLInputElement && !['text', 'search', 'url', 'email'].includes(field.type)) return;
      if (document.body.dataset.tutorial && field.hasAttribute('data-tour')) return;
      const example = field.dataset.tabExample ?? (/^(예\s*[:：]|e\.g\.[,:]?|example\s*:)/i.test(field.placeholder) ? field.placeholder.replace(/^(예\s*[:：]|e\.g\.[,:]?|example\s*:)\s*/i, '') : '');
      if (!example || field.maxLength > -1 && example.length > field.maxLength) return;
      event.preventDefault();
      const prototype = field instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(field, example);
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
    }
    document.addEventListener('keydown', complete, true);
    return () => document.removeEventListener('keydown', complete, true);
  }, []);
  return null;
}
