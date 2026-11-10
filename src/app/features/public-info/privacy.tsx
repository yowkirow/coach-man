// Reviewed for accuracy against the code on 2026-11-10 (what's collected, who sees it, how long
// it's kept, what's public): every statement here should stay true of the code, so change them
// together. Written in plain language as a starting point; it is not legal advice. A lawyer's
// review under the Data Privacy Act of 2012 (RA 10173) and the NPC's rules is still recommended,
// as is naming who runs CoachMan. The contact address comes from PUBLIC_CONTACT_EMAIL
// (wrangler.jsonc).

import { Link } from "@tanstack/react-router";
import { ContactEmail } from "./legal-links";
import { Bullets, type DocSection, DocumentPage, Sub } from "./shell";

const link =
  "rounded-sm font-medium underline decoration-line-strong underline-offset-4 outline-none hover:decoration-ink focus-visible:outline-2 focus-visible:outline-ink";

export const PRIVACY_UPDATED = "November 10, 2026";

const SECTIONS: DocSection[] = [
  {
    id: "who",
    title: "Who is responsible",
    body: (
      <>
        <p>
          CoachMan is an app that pickleball academies and coaches use to run their sessions,
          students, packages, and family portal. Two parties look after the information in it:
        </p>
        <Bullets>
          <li>
            <strong className="font-medium">Each academy</strong> decides what it records about its
            students, parents, and staff, and why. Under the Philippine Data Privacy Act of 2012
            (Republic Act No. 10173), the academy is the personal information controller for that
            information.
          </li>
          <li>
            <strong className="font-medium">The CoachMan team</strong> runs the app and processes
            that information for the academy, on its instructions, as its personal information
            processor. We are the controller for your sign-in account and for the security records
            that keep the service safe.
          </li>
        </Bullets>
        <p>
          So for questions about a student's records (what's kept, corrections, deleting them),
          start with your academy. For your account, or if you can't reach your academy, write to us
          at <ContactEmail />.
        </p>
      </>
    ),
  },
  {
    id: "collect",
    title: "What we collect",
    body: (
      <>
        <Sub>Your account</Sub>
        <Bullets>
          <li>Your name and email address.</li>
          <li>
            If you sign in with Google: the basics Google shares with us (your name, email address,
            whether Google has verified it, and your profile picture's address), and the sign-in
            tokens Google issues for the link between your Google account and CoachMan. We don't ask
            Google for anything else.
          </li>
          <li>
            If you use passkeys: each passkey's public key and its technical details (an ID, a
            counter, the kind of device). The private part of a passkey never leaves your device.
            Passkey-only accounts get a placeholder address instead of an email.
          </li>
          <li>
            Staff: your role at each academy and the coach profile you fill in (name shown, title,
            bio, photos, certifications, highlights, rating, specialties, languages, years
            coaching).
          </li>
        </Bullets>

        <Sub>What academies record about their students and families</Sub>
        <Bullets>
          <li>
            Student details: names, birth dates, contact details, parents' or guardians' names and
            contact details, emergency contacts, level and ratings, shirt sizes, photos, and notes.
          </li>
          <li>
            Health and safety: medical notes (allergies, conditions, medications) and the people
            allowed to pick up a junior, with their names, relationships, phone numbers, notes, and
            photos.
          </li>
          <li>
            Training: schedules, attendance, packages and credits, skill assessments, goals,
            ratings, and coaches' comments.
          </li>
          <li>
            Money records: charges, payments, balances, and the payment proofs families send (the
            screenshot, amount, method, reference number, and date). Payments themselves happen
            outside CoachMan.
          </li>
          <li>
            Enrollment requests and their answers, and consents: which form was signed, the version,
            the typed name, the relation (parent or self), the time, and the IP address and browser
            it was signed from.
          </li>
          <li>
            Announcements the academy publishes, and a log of important changes (see Security).
          </li>
        </Bullets>
        <p>
          Some of this is sensitive personal information under the law, notably health information
          and age. Academies collect it with consent, including a parent's consent for a minor.
        </p>

        <Sub>From your device</Sub>
        <Bullets>
          <li>
            A sign-in cookie that keeps you signed in, and short-lived cookies used while you sign
            in with Google. CoachMan uses no advertising or tracking cookies.
          </li>
          <li>
            The IP address and browser of each sign-in session, kept with the session for security.
          </li>
          <li>
            IP addresses in short-lived counters that limit how often sign-in, invite, and public
            pages can be tried (to stop guessing and abuse).
          </li>
          <li>
            If you turn on notifications: your browser's push address and keys, which browser it is,
            and which reminders were sent, so the same one isn't sent twice.
          </li>
          <li>
            A log of each request to the app, as on any website: the address asked for, the time,
            and connection details such as the IP address, approximate location, and browser. It's
            used to find faults and stop abuse.
          </li>
          <li>
            An offline copy on your device of what you opened, so the app works without signal, and
            the answers of an enrollment form you haven't sent yet. Both are cleared when you sign
            out or when someone else signs in on the same device.
          </li>
        </Bullets>
      </>
    ),
  },
  {
    id: "use",
    title: "How it's used, and why that's allowed",
    body: (
      <>
        <p>We use the information only to provide CoachMan:</p>
        <Bullets>
          <li>
            to run the academy's work: schedules, check-ins, credits, progress, enrollment, payment
            records, announcements, and the family portal (on the academy's instructions, under its
            agreement with its families);
          </li>
          <li>
            to show coaches what they need at the court, like a junior's medical note and who may
            pick them up;
          </li>
          <li>
            to sign you in and keep accounts secure: sessions, passkeys, rate limits, request logs,
            and records of who changed what (our legitimate interest in a safe service, and the
            academy's);
          </li>
          <li>to send the reminders and notifications you turn on (your consent);</li>
          <li>to keep the records the academy needs, such as signed consents and payments.</li>
        </Bullets>
        <p>
          The legal bases are the ones the Data Privacy Act provides: the consent of the person (or
          their parent or guardian) the academy collects at enrollment; what's needed to provide the
          training and the service people signed up for; the law, where it requires a record; and
          legitimate interests such as security. Health information is processed with consent, or
          where it's needed to protect someone's life and health.
        </p>
        <p>
          We don't sell personal information, use it for advertising, or build profiles of you.
          CoachMan has no ads, no analytics or tracking scripts, and no tracking pixels.
        </p>
      </>
    ),
  },
  {
    id: "minors",
    title: "Children and teens",
    body: (
      <>
        <p>Many academy students are minors, so CoachMan is built around their parents:</p>
        <Bullets>
          <li>
            A parent or guardian enrolls a minor and gives the consents the academy asks for,
            including a parental consent.
          </li>
          <li>Children under 13 never get their own login. Their parents follow along.</li>
          <li>
            Teens aged 13 to 17 get their own login only once a parent is linked to them. A teen can
            read their health details and pickup people but not change them; their parent does.
          </li>
          <li>
            Families only ever see their own students. Coaches' comments stay among coaches unless a
            coach shares one.
          </li>
        </Bullets>
      </>
    ),
  },
  {
    id: "share",
    title: "Who we share it with",
    body: (
      <>
        <p>
          Within an academy, people see what their role needs: owners and admins see everything for
          their academy, front desk staff see students, the schedule, and payments (of a student's
          progress, only what's shared with the family), coaches see students and progress but no
          money, and families see only their own students. Academies don't see each other's
          information.
        </p>
        <p>
          An academy can also publish a public page and a team page. Anyone can see what it puts
          there: its contact details, programs, schedules, and prices; its cover photo and the
          website photos it uploads, with their captions; its coaches' profiles (name, photos,
          title, bio, certifications, highlights, rating, specialties, languages, and years
          coaching); and anyone else it adds to its team page, as it describes them. A coach can
          keep their profile off these pages with “Show on the academy page”. Student and family
          records are never public. If the academy's photos show people, the academy needs their
          permission to publish them, and a parent's or guardian's for a child.
        </p>
        <p>Outside the academy, we use a small number of service providers:</p>
        <Bullets>
          <li>
            <strong className="font-medium">Cloudflare</strong> hosts CoachMan, stores its database
            and files (in its Asia-Pacific region), keeps its request logs, and protects it on the
            way in. Like any website, requests pass through Cloudflare's network, which may be
            outside the Philippines.
          </li>
          <li>
            <strong className="font-medium">Google</strong>, only if you choose to sign in with
            Google.
          </li>
          <li>
            Your browser's push service (from Google, Apple, Mozilla, or Microsoft, depending on
            your browser), only if you turn on notifications. It carries the notification without
            being able to read it.
          </li>
        </Bullets>
        <p>
          CoachMan doesn't process payments, so no payment company receives your information from
          us. We share information with authorities only when the law requires it.
        </p>
      </>
    ),
  },
  {
    id: "keep",
    title: "How long it's kept",
    body: (
      <>
        <p>
          An academy's records stay while the academy uses CoachMan, so its history (credits,
          payments, consents) can be explained. Academies can archive or delete students, and export
          their records at any time. When an academy closes its account, we delete its data on
          request. Your account stays until you ask us to delete it.
        </p>
        <p>Some things are removed on their own:</p>
        <Bullets>
          <li>
            sign-in sessions end when you sign out or after 30 days without use, and are deleted
            within a day of ending;
          </li>
          <li>our rate-limit counters are cleared within two days;</li>
          <li>request logs are deleted after 7 days at most;</li>
          <li>passkey-only accounts that never got a passkey are deleted within two days;</li>
          <li>the record of which notifications were sent is deleted after 90 days;</li>
          <li>
            the short-term records used to sync offline changes exactly once are deleted after 30
            days.
          </li>
        </Bullets>
        <p>
          Deleted data can remain in our hosting provider's recovery history for up to 30 days
          before it's gone.
        </p>
      </>
    ),
  },
  {
    id: "security",
    title: "How it's protected",
    body: (
      <Bullets>
        <li>
          Everything travels over HTTPS, and Cloudflare stores the database and files encrypted.
        </li>
        <li>
          There are no passwords to steal: you sign in with Google or a passkey. Invite links are
          single-use and expire after 7 days, and our database keeps them only in a scrambled
          (hashed) form.
        </li>
        <li>
          Every request is checked against your role and your links: coaches never get money
          details, and families only reach their own students. Students' photos, payment proofs, and
          pickup photos are private files served only to people allowed to see them. Only what an
          academy publishes, such as its logo, its cover and website photos, and its team's photos,
          is public.
        </li>
        <li>
          Important changes are logged with who made them and when: access given or ended, consents,
          payments, and edits to medical details and pickup people (the log names what changed,
          never the medical text).
        </li>
        <li>The app loads no third-party scripts.</li>
      </Bullets>
    ),
  },
  {
    id: "rights",
    title: "Your rights",
    body: (
      <>
        <p>Under the Data Privacy Act you have the right to:</p>
        <Bullets>
          <li>be informed about how your information is used (this page);</li>
          <li>access the information kept about you, or your child;</li>
          <li>correct information that's wrong or out of date;</li>
          <li>
            have information erased or blocked when it's no longer needed or was kept unlawfully;
          </li>
          <li>object to processing, and withdraw a consent you gave;</li>
          <li>get a copy of your information in a format you can take elsewhere (portability);</li>
          <li>
            complain to the National Privacy Commission (
            <a href="https://privacy.gov.ph" className={link} rel="noreferrer" target="_blank">
              privacy.gov.ph
            </a>
            ).
          </li>
        </Bullets>
        <p>
          Parents can update a child's health details and pickup people themselves, in the family
          portal's Profile. For anything else about a student's records, ask your academy: it
          controls them and can correct, export, or delete them. For your account, or if your
          academy doesn't help, write to <ContactEmail />. We may need to confirm who you are first,
          and we'll tell you what we did.
        </p>
      </>
    ),
  },
  {
    id: "changes",
    title: "Changes to this policy",
    body: (
      <p>
        When this policy changes, we update the date at the top. If a change affects information
        already collected, we'll tell academies first and ask for consent where the law requires it.
        The{" "}
        <Link to="/terms" className={link}>
          terms of use
        </Link>{" "}
        explain the rest of how CoachMan works.
      </p>
    ),
  },
];

export function PrivacyPolicy() {
  return (
    <DocumentPage
      page="privacy"
      title="Privacy policy"
      updated={PRIVACY_UPDATED}
      intro={
        <p>
          What CoachMan collects, why, who sees it, how long it's kept, and how to use your rights
          under the Data Privacy Act of 2012.
        </p>
      }
      sections={SECTIONS}
    />
  );
}
