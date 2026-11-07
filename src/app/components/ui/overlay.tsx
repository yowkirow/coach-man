import { MoreHorizontal, X } from "lucide-react";
import type { ReactNode } from "react";
import {
  Dialog,
  Heading,
  MenuItem,
  MenuTrigger,
  Modal,
  ModalOverlay,
  Popover,
  Menu as RACMenu,
} from "react-aria-components";
import { Button, IconButton } from "./button";
import { popoverClass } from "./field";

export interface SheetProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "md" | "lg";
}

/** Bottom sheet on phones, centred dialog on larger screens. For focused tasks only. */
export function Sheet({
  isOpen,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
}: SheetProps) {
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable
      className="fixed inset-0 z-50 flex items-end justify-center bg-night/45 backdrop-blur-[2px] data-[entering]:animate-[fade-in_150ms_ease-out] sm:items-center sm:p-6"
    >
      <Modal
        className={`flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[32px] bg-card shadow-pop outline-none data-[entering]:animate-[sheet-up_240ms_var(--ease-out-expo)] sm:rounded-[32px] ${size === "lg" ? "sm:max-w-2xl" : "sm:max-w-lg"}`}
      >
        <Dialog className="flex min-h-0 flex-1 flex-col outline-none">
          {({ close }) => (
            <>
              <div className="flex items-start justify-between gap-3 px-6 pt-6 pb-2">
                <div className="min-w-0">
                  <Heading
                    slot="title"
                    className="text-[1.5rem] leading-tight font-light tracking-[-0.01em]"
                  >
                    {title}
                  </Heading>
                  {description ? (
                    <p className="mt-1.5 text-[0.875rem] text-ink-2">{description}</p>
                  ) : null}
                </div>
                <IconButton
                  label="Close"
                  size="sm"
                  variant="soft"
                  onPress={close}
                  className="shrink-0"
                >
                  <X aria-hidden className="size-4.5" />
                </IconButton>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-4 pb-6">{children}</div>
              {footer ? (
                <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-line px-6 py-4 safe-bottom">
                  {footer}
                </div>
              ) : null}
            </>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

export function ConfirmSheet({
  isOpen,
  onOpenChange,
  title,
  body,
  confirmLabel,
  tone = "danger",
  onConfirm,
  isPending,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  tone?: "danger" | "dark";
  onConfirm: () => void;
  isPending?: boolean;
}) {
  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={title}
      footer={
        <>
          <Button variant="light" onPress={() => onOpenChange(false)}>
            Keep it
          </Button>
          <Button variant={tone} onPress={onConfirm} isPending={isPending}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-ink-2">{body}</div>
    </Sheet>
  );
}

export interface MenuAction {
  id: string;
  label: string;
  tone?: "danger";
  onAction: () => void;
  isDisabled?: boolean;
}

export function ActionMenu({
  label,
  actions,
  trigger,
  dark = false,
}: {
  label: string;
  actions: MenuAction[];
  trigger?: ReactNode;
  dark?: boolean;
}) {
  return (
    <MenuTrigger>
      {trigger ?? (
        <IconButton label={label} size="md" variant={dark ? "night" : "ghost"}>
          <MoreHorizontal aria-hidden className="size-5" />
        </IconButton>
      )}
      <Popover placement="bottom end" className={`min-w-56 ${popoverClass}`}>
        <RACMenu
          aria-label={label}
          className="outline-none"
          onAction={(key) => actions.find((a) => a.id === key)?.onAction()}
          disabledKeys={actions.filter((a) => a.isDisabled).map((a) => a.id)}
        >
          {actions.map((a) => (
            <MenuItem
              key={a.id}
              id={a.id}
              className={`flex cursor-pointer items-center rounded-xl px-3 py-2.5 outline-none data-[disabled]:opacity-45 data-[focused]:bg-panel ${a.tone === "danger" ? "text-[#b42318]" : "text-ink"}`}
            >
              {a.label}
            </MenuItem>
          ))}
        </RACMenu>
      </Popover>
    </MenuTrigger>
  );
}
