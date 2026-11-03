import { createFileRoute } from "@tanstack/react-router";
import { Page, ShellAside, useIsDesktop } from "../../components/layout/app-shell";
import { PageHeader } from "../../components/ui/display";
import { AcademySection } from "../../features/settings/academy";
import { AppDataSection } from "../../features/settings/app-data";
import { NotificationsSection } from "../../features/settings/notifications";
import { ConnectionPill } from "../../features/settings/offline";
import { PaymentMethodsSection } from "../../features/settings/payment-methods";
import { RubricSection } from "../../features/settings/rubric";
import {
  SectionChips,
  SettingsNav,
  useActiveSection,
  useSettingsSections,
} from "../../features/settings/sections";
import { SecuritySection } from "../../features/settings/security";
import { VenuesSection } from "../../features/settings/venues";
import { PoliciesSection, WorkspaceSection } from "../../features/settings/workspace-settings";
import { useCan, useMe } from "../../lib/hooks";

export const Route = createFileRoute("/_app/settings")({ component: SettingsPage });

function SettingsPage() {
  const me = useMe().data;
  const can = useCan();
  const desktop = useIsDesktop();
  const sections = useSettingsSections();
  const { active, jump } = useActiveSection(sections.map((s) => s.id));

  return (
    <>
      <ShellAside>
        <SettingsNav me={me} active={active} onJump={jump} />
      </ShellAside>
      <Page className="flex flex-col gap-4 pb-6 lg:pb-[30vh]">
        <PageHeader
          title="Settings"
          subtitle={me ? `${me.workspace.name} · ${me.user.email}` : undefined}
          actions={<ConnectionPill />}
          className="mb-1"
        />
        {desktop ? null : <SectionChips onJump={jump} />}
        <AcademySection />
        {can.settings ? (
          <>
            <WorkspaceSection />
            <PoliciesSection />
            <PaymentMethodsSection />
            <VenuesSection />
            <RubricSection />
          </>
        ) : null}
        <SecuritySection />
        <NotificationsSection />
        <AppDataSection />
      </Page>
    </>
  );
}
