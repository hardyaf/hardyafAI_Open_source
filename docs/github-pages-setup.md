# GitHub Pages information website

The public information website uses the existing repository. Its three HTML pages describe Hardy Home (house-bot), Google account access, privacy and terms. It has one local stylesheet, no scripts/forms/remote assets, no application login and no credentials. This is an informational site, not a public deployment of the household application.

## Ownership and reuse

Reuse GitHub Pages branch publishing and the existing docs folder. The website introduces no backend, identity authority, credential store, queue or database. The app and connected providers retain their existing ownership. The policy text describes the current implementation; changing a disclosure never grants new account access or implements a missing deletion feature.

All website URLs are relative so the same files work beneath the project prefix. No custom domain, CNAME or paid service is configured.

## GitHub UI after the push

1. Open the repository Settings, then Pages.
2. GitHub Free supports Pages for a public repository. If this repository is private, either keep it private with a plan that supports private-repository Pages, or make a deliberate visibility decision after reviewing the entire repository and its history. Making a repository public exposes its source, branches and history, not only these website files. A separate public information-only repository remains an alternative.
3. Under Build and deployment, set Source to Deploy from a branch.
4. Choose the branch containing these files: codex/household-slice-1. Select /docs and Save. The repository's default branch need not change.
5. Open the Actions tab or return to Pages to observe the pages-build-deployment result. After it succeeds, use Visit site. Publishing can take several minutes.
6. Use HTTPS. The default github.io address supports HTTPS without a purchased domain.

The expected default site is:

- Homepage: https://hardyaf.github.io/hardyafAI_Open_source/
- Privacy: https://hardyaf.github.io/hardyafAI_Open_source/privacy.html
- Terms: https://hardyaf.github.io/hardyafAI_Open_source/terms.html

Pages settings and repository visibility are deliberately left for the owner; a push is not proof that the website is live.

## Files and future updates

The publishing-source root contains index.html, privacy.html, terms.html, site.css and the empty .nojekyll marker. The marker disables Jekyll processing; it does not hide other tracked files in docs. Keep private deployment data out of this public tree. No build command, package installation or custom workflow is required.

The support address is the same bot address selected for the existing Google consent screen. The pages identify both the household product name and the existing house-bot OAuth name. Match Google's current app name if it is changed later.

## Google publishing is a separate step

After the HTTPS pages are publicly reachable, use the three URLs above in Google Auth Platform Branding. If the console accepts the free hosting domain for the current limited-audience configuration, its Authorized domain is hardyaf.github.io, without a URL scheme or project path.

Keep the existing External app for multiple Gmail accounts. In Audience, Publish app changes the publishing status to In production; it is not full OAuth/brand verification. Google documents an exception to full verification for a limited audience of fewer than 100 users, with the unverified-app warning and user cap remaining. That exception is not a promise that every Branding/domain check will accept this configuration.

GitHub supplies free hosting and an address. It does not give us DNS control over github.io or confer Google domain verification. If Google's console requires DNS-level ownership verification or rejects the shared hosting domain, record that exact requirement; do not claim verification or substitute an unrelated domain. A domain under the operator's DNS control is a separate option, not part of this deployment. Existing External projects cannot be converted to Google's creator-only Personal mode.

After changing from Testing, complete a fresh Google authorization in the private Hardy Home interface. Gmail/Calendar refresh tokens issued during Testing have Google's seven-day lifetime. Do not publish client secrets, refresh tokens, invitation links or private application URLs on this information site.

## Review and rollback

Review disclosure changes against current account tools, credential storage, local processing, record retention and disconnect behavior. In particular, chat removal is not complete erasure, and disconnect does not erase retained records or the stored Bitwarden secret. The website is not evidence of Google verification or a complete compliance audit.

Rollback replaces only these static files or changes the Pages publishing selection. It must not restore an application database, revoke an account grant or change the private runtime.

Official references:

- https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
- https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site
- https://support.google.com/cloud/answer/15549049
- https://support.google.com/cloud/answer/15549945
- https://support.google.com/cloud/answer/13464323
- https://support.google.com/cloud/answer/13804266
