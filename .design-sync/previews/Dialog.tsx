import { Button, Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, Input, Label, TextField } from '@dpg/ui';

export const Open = () => (
  <DialogTrigger defaultOpen>
    <Button variant="outline">Share this plan</Button>
    <Dialog>
      <DialogHeader>
        <DialogTitle>Share this plan</DialogTitle>
        <DialogDescription>A read-only link: the full plan, or dates and stops only.</DialogDescription>
      </DialogHeader>
      <TextField className="grid gap-1.5" defaultValue="kilometrica.com/plan#p=8f3k…" isReadOnly>
        <Label>Link</Label>
        <Input />
      </TextField>
      <DialogFooter>
        <DialogClose>Close</DialogClose>
        <Button>Copy link</Button>
      </DialogFooter>
    </Dialog>
  </DialogTrigger>
);

export const Closed = () => (
  <DialogTrigger>
    <Button variant="outline">Share this plan</Button>
    <Dialog>
      <DialogHeader>
        <DialogTitle>Share this plan</DialogTitle>
      </DialogHeader>
    </Dialog>
  </DialogTrigger>
);
