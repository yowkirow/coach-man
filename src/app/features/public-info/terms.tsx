// Reviewed for accuracy against the code on 2026-11-06: every statement here should stay true of
// how CoachMan works, so change them together. Written in plain language as a starting point; it
// is not legal advice. A lawyer's review under Philippine law is still recommended (who provides
// CoachMan, support, termination, liability). The contact address comes from
// PUBLIC_CONTACT_EMAIL (wrangler.jsonc).

import { Link } from "@tanstack/react-router";
import { ContactEmail } from "./legal-links";
import { Bullets, type DocSection, DocumentPage } from "./shell";

const link =
  "rounded-sm font-medium underline decoration-line-strong underline-offset-4 outline-none hover:decoration-ink focus-visible:outline-2 focus-visible:outline-ink";

export const TERMS_UPDATED = "November 6, 2026";

const SECTIONS: DocSection[] = [
  {
    id: "agreement",
    title: "Using CoachMan",
    body: (
      <>
        <p>
          CoachMan is provided by the CoachMan team for pickleball academies, their coaches and
          staff, and their students and parents. By signing in or using it, you agree to these terms
          and to the{" "}
          <Link to="/privacy" className={link}>
            privacy policy
          </Link>
          . If you use CoachMan for an academy, you also agree on the academy's behalf, and you
          confirm you're allowed to.
        </p>
        <p>
          Your training itself (sessions, coaching, prices, schedules, refunds) is between you and
          your academy, under the academy's own policies. CoachMan is the tool, not a party to that
          agreement.
        </p>
      </>
    ),
  },
  {
    id: "accounts",
    title: "Accounts",
    body: (
      <Bullets>
        <li>
          You sign in with Google or with a passkey on your device. Keep your devices and your
          Google account secure; you're responsible for what's done with your account.
        </li>
        <li>One account per person. Use your own name and keep your details accurate.</li>
        <li>
          Staff join an academy through an invite link from its owner or an admin. Families join
          through their academy's invite link, or by enrolling from its CoachMan page. Anyone can
          also set up CoachMan for their own coaching or academy.
        </li>
        <li>
          Children under 13 don't get their own login; a parent or guardian follows their training.
          Teens aged 13 to 17 get a login only once a parent is linked, and parents are responsible
          for how their children use CoachMan.
        </li>
        <li>
          Invite links are for the person they were sent to. Don't share or forward them to anyone
          else.
        </li>
      </Bullets>
    ),
  },
  {
    id: "academies",
    title: "Academies and their information",
    body: (
      <>
        <p>Each academy is responsible for the information it puts into CoachMan. It agrees to:</p>
        <Bullets>
          <li>
            have a lawful basis for collecting and using it, including the consents the Data Privacy
            Act requires: a parent's or guardian's consent for minors, and consent for sensitive
            information such as health details and photos;
          </li>
          <li>keep it accurate, and use it only to run its training;</li>
          <li>
            give staff the role their work needs, and remove people's access when it should end;
          </li>
          <li>
            put someone on its team page only with their agreement, and take them off when they ask;
          </li>
          <li>
            publish photos of people (its cover photo and website photos) only with their
            permission, including a parent's or guardian's consent for a minor;
          </li>
          <li>
            answer its students' and parents' requests about their information (access, corrections,
            deletion), with our help where needed.
          </li>
        </Bullets>
        <p>
          The consent forms and templates in CoachMan are starting points, not legal advice. Each
          academy is responsible for the texts it publishes and has signed.
        </p>
        <p>
          The academy's information is the academy's. It can export its records at any time, and ask
          us for anything the export doesn't include, such as photos. We use it only to provide
          CoachMan, as the privacy policy describes.
        </p>
      </>
    ),
  },
  {
    id: "acceptable-use",
    title: "Acceptable use",
    body: (
      <>
        <p>Don't use CoachMan to:</p>
        <Bullets>
          <li>break the law, or record information about people you have no right to record;</li>
          <li>
            harass anyone, or upload anything harmful, deceptive, or that isn't yours to share;
          </li>
          <li>
            get into accounts, academies, or information that aren't yours, or test, probe, or work
            around the app's security, limits, or roles;
          </li>
          <li>copy the service, or collect data from it with scripts or bots;</li>
          <li>send payment proofs or other records you know are false.</li>
        </Bullets>
      </>
    ),
  },
  {
    id: "payments",
    title: "Payments",
    body: (
      <>
        <p>
          CoachMan doesn't process payments. Families pay their academy directly, in the ways the
          academy accepts (such as GCash, a bank transfer, or cash). CoachMan keeps the academy's
          records of charges and payments, and lets families send a screenshot as proof of a payment
          for the academy to confirm.
        </p>
        <p>
          Prices, what's owed, refunds, and any disagreement about a payment are between the family
          and the academy.
        </p>
      </>
    ),
  },
  {
    id: "availability",
    title: "Availability and changes",
    body: (
      <>
        <p>
          We work to keep CoachMan running and your information safe, and parts of it work offline.
          But it's provided as it is, without a promise that it will always be available, error
          free, or suited to every purpose. We may change, add, or remove features as CoachMan
          develops.
        </p>
        <p>
          Keep your own copies of anything critical: academies can export their records at any time.
        </p>
      </>
    ),
  },
  {
    id: "ending",
    title: "Ending your use",
    body: (
      <>
        <p>
          You can stop using CoachMan at any time. To have your account deleted, write to us. An
          academy can end a staff member's or a family's access at any time, and can ask us to close
          its account and delete its data.
        </p>
        <p>
          We may suspend or close an account that breaks these terms or puts other people or their
          information at risk. Where we can, we'll tell you why first.
        </p>
      </>
    ),
  },
  {
    id: "liability",
    title: "Our responsibility",
    body: (
      <>
        <p>
          As far as Philippine law allows, the CoachMan team isn't liable for indirect or
          consequential losses, for lost profits or data, or for the training, services, and
          decisions of academies (including anything that happens at a session). Nothing in these
          terms limits a responsibility that the law doesn't allow to be limited.
        </p>
      </>
    ),
  },
  {
    id: "law",
    title: "Governing law",
    body: (
      <p>
        These terms are governed by the laws of the Republic of the Philippines, and disputes about
        them go to the courts of the Philippines.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Changes and contact",
    body: (
      <>
        <p>
          When these terms change, we update the date at the top. If a change matters to how you use
          CoachMan, we'll tell academies before it takes effect.
        </p>
        <p>
          Questions about these terms, your account, or your information: write to the CoachMan team
          at <ContactEmail />.
        </p>
      </>
    ),
  },
];

export function TermsOfUse() {
  return (
    <DocumentPage
      page="terms"
      title="Terms of use"
      updated={TERMS_UPDATED}
      intro={
        <p>
          The rules for using CoachMan, for academies and their coaches, and for students and
          parents. In plain words, so they're easy to follow.
        </p>
      }
      sections={SECTIONS}
    />
  );
}
