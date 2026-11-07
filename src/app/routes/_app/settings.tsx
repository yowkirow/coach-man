import { createFileRoute } from "@tanstack/react-router";
import { Page, ShellAside, useIsDesktop } from "../../components/layout/app-shell";
import { PageHeader } from "../../components/ui/display";
import { MyCoachProfileSection } from "../../features/coaches/profile";
import { ConsentsSection } from "../../features/consents/settings-section";
import { LegalLinks } from "../../features/public-info/legal-links";
import { AcademySection } from "../../features/settings/academy";
import { AcademyProfileSection } from "../../features/settings/academy-profile";
import { AppDataSection } from "../../features/settings/app-data";
import { NotificationsSection } from "../../features/settings/notifications";
import { ConnectionPill } from "../../features/settings/offline";
import { PaymentMethodsSection } from "../../features/settings/payment-methods";
import { RubricSection } from "../../features/settings/rubric";
import {
  SectionChips,
  SettingsNav,
  SettingsSection,
  useActiveSection,
  useSettingsSections,
} from "../../features/settings/sections";
import { SecuritySection } from "../../features/settings/security";
import { VenuesSection } from "../../features/settings/venues";
import { WebsitePhotosSection } from "../../features/settings/website-photos";
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
            <AcademyProfileSection />
            <WebsitePhotosSection />
          </>
        ) : null}
        <SettingsSection
          id="coach-profile"
          title="My coach profile"
          description="How you appear to your team, and to your academy's students and parents."
        >
          {me ? <MyCoachProfileSection userId={me.user.id} /> : null}
        </SettingsSection>
        {can.settings ? (
          <>
            <WorkspaceSection />
            <PoliciesSection />
            <ConsentsSection />
            <PaymentMethodsSection />
            <VenuesSection />
            <RubricSection />
          </>
        ) : null}
        <SecuritySection />
        <NotificationsSection />
        <AppDataSection />
        <LegalLinks className="px-1 pt-2" />
      </Page>
    </>
  );
}
