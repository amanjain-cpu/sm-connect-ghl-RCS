import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { formatPhoneNumber } from '@/lib/utils';

export const PROVISIONING_NOTE =
  'Please wait 15 to 20 minutes until your newly purchased phone number is fully provisioned before sending SMS.';

type ProvisioningNoteDialogProps = {
  open: boolean;
  phoneNumber?: string | null;
  onOpenChange: (open: boolean) => void;
};

export function ProvisioningNoteDialog({
  open,
  phoneNumber,
  onOpenChange,
}: ProvisioningNoteDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Phone Number Provisioning</DialogTitle>
          <DialogDescription>
            {phoneNumber ? `${formatPhoneNumber(phoneNumber)} is being prepared for SMS traffic.` : null}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm leading-6 text-slate-700 dark:text-slate-300">
          {PROVISIONING_NOTE}
        </p>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>
            OK
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
