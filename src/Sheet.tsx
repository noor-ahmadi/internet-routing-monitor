import { useState, type ComponentProps, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Cross2Icon } from '@radix-ui/react-icons';
import { AnimatePresence, useReducedMotion } from 'motion/react';
import * as m from 'motion/react-m';

// Adapted from shadcn/ui's Sheet composition. See THIRD_PARTY_NOTICES.md.
export function Sheet({ open, onOpenChange, title, description, children, trigger, side = 'left',
  closeLabel = 'Close panel', className = '', onCloseAutoFocus }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string;
  children: ReactNode; trigger?: ReactNode; side?: 'left' | 'right' | 'center';
  closeLabel?: string; className?: string; onCloseAutoFocus?: ComponentProps<typeof Dialog.Content>['onCloseAutoFocus'];
}) {
  const reduced = useReducedMotion();
  const offset = side === 'left' ? '-100%' : side === 'right' ? '100%' : 0;
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    {trigger && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}
    <Dialog.Portal forceMount><AnimatePresence>
      {open && <m.div key="sheet" className="sheet-layer" initial="closed" animate="open" exit="closed">
        <Dialog.Overlay forceMount asChild><m.div className="dialog-overlay"
          variants={{ closed: { opacity: 0 }, open: { opacity: 1 } }} transition={{ duration: reduced ? 0 : .22 }} /></Dialog.Overlay>
        <Dialog.Content forceMount asChild onCloseAutoFocus={onCloseAutoFocus}>
          <m.section className={`sheet sheet-${side} ${className}`}
            variants={{ closed: { x: reduced ? 0 : offset, y: !reduced && side === 'center' ? 14 : 0, opacity: 0 }, open: { x: 0, y: 0, opacity: 1 } }}
            transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 30 }}>
            <div className="sheet-header"><div><span className="eyebrow">Investigation / {side === 'right' ? '02' : '01'}</span><Dialog.Title>{title}</Dialog.Title></div>
              <Dialog.Close className="icon-button close-panel" aria-label={closeLabel}><Cross2Icon aria-hidden="true" /></Dialog.Close></div>
            <Dialog.Description className={description ? 'dialog-description' : 'sr-only'}>{description}</Dialog.Description>
            {children}
          </m.section>
        </Dialog.Content>
      </m.div>}
    </AnimatePresence></Dialog.Portal>
  </Dialog.Root>;
}

export function Modal({ title, description = '', children, trigger }: { title: string; description?: string; children: ReactNode; trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <Sheet open={open} onOpenChange={setOpen} title={title} description={description} trigger={trigger} side="center" closeLabel="Close dialog">{children}</Sheet>;
}
