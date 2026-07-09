/*
  Sudan Relief News feature — extracted from "I Love My Office App.dc.html"
  for reference. This is not a standalone runnable file; it shows the pieces
  added to the DC's logic class (c_dc_js) and template (b_dc_html).
*/

/* ---------- Added to the logic class ---------- */

class Component /* extends DCLogic (in the real file) */ {

  // Who can see the news card on Home:
  NEWS_VIEWERS = ['Margaret', 'Seyfu', 'Isabel', 'Nicola'];
  // Who can fetch / approve+post / dismiss items:
  NEWS_APPROVERS = ['Margaret', 'Seyfu'];

  // ReliefWeb requires a pre-approved "appname" for live API access (free,
  // register yourself at https://apidoc.reliefweb.int/parameters#appname —
  // any email works, org email not required). Paste the approved name here
  // to turn on live fetching; until then, checkForNews() falls back to the
  // sample pool below.
  RELIEFWEB_APPNAME = 'REPLACE-WITH-YOUR-APPROVED-APPNAME';

  // Sample humanitarian/relief headlines used to simulate an incoming feed
  // when the live API isn't configured or a request fails.
  SUDAN_NEWS_POOL = [
    { headline: 'UN agencies scale up food distribution in Darfur displacement camps', source: 'OCHA', summary: 'Aid agencies report expanded ration deliveries reaching several camps after access improved this week.' },
    { headline: 'Cross-border aid convoys resume into South Kordofan after weeks of delay', source: 'ReliefWeb', summary: 'Convoys carrying medical supplies and food crossed after a temporary halt tied to access negotiations.' },
    { headline: 'WHO warns of rising cholera cases in Khartoum-area shelters', source: 'Al Jazeera', summary: 'Health teams are scaling up water treatment and case management in crowded shelter sites.' },
    { headline: 'Local NGOs report shortage of clean water access in White Nile state', source: 'Sudan Tribune', summary: 'Community groups are calling for urgent support to repair damaged water infrastructure.' },
    { headline: 'Refugee arrivals in Chad and Egypt continue to climb, UNHCR says', source: 'BBC', summary: 'Registration sites near the border are stretched as new arrivals continue week over week.' },
    { headline: 'Community kitchens in Omdurman expand meal programs amid funding gaps', source: 'AP', summary: 'Volunteer-run kitchens say they need more funding to keep pace with rising demand.' },
    { headline: 'Famine risk classifications updated for several central Sudan localities', source: 'FEWS NET', summary: 'Latest food-security projections flag a worsening outlook heading into the coming season.' },
    { headline: 'Aid corridors face renewed access restrictions near front lines', source: 'Reuters', summary: 'Humanitarian groups say permits and security clearances are slowing convoy movements.' },
    { headline: 'Displacement camps report overcrowding as new arrivals outpace shelter capacity', source: 'The Washington Post', summary: 'Camp coordinators are appealing for additional tents and sanitation support.' },
    { headline: 'Aid groups warn funding shortfalls threaten scale-up of relief operations', source: 'Humanitarian News', summary: 'Several agencies say current pledges cover only a fraction of the response plan.' },
    { headline: 'Health facilities in conflict-affected areas report medicine and staff shortages', source: 'CNN', summary: 'Remaining clinics describe rationing supplies as restocking routes remain disrupted.' },
    { headline: 'Regional bodies call for expanded humanitarian access across Sudan', source: 'Middle East Monitor', summary: 'Officials are pressing for guaranteed safe passage for aid convoys and workers.' }
  ];

  isNewsViewer() { return this.NEWS_VIEWERS.includes(this.ME); }
  isNewsApprover() { return this.NEWS_APPROVERS.includes(this.ME); }

  fallbackSampleFetch(reason) {
    this.db.ref('sudanNewsCursor').transaction(c => (c || 0) + 1).then(res => {
      const cursor = (res.snapshot.val() || 1) - 1;
      const item = this.SUDAN_NEWS_POOL[cursor % this.SUDAN_NEWS_POOL.length];
      this.db.ref('sudanNews').push({ ...item, fetchedAt: Date.now(), status: 'pending' });
      this.setState({ newsFetching: false });
      this.flashMsg(reason || 'Fetched a new relief update');
    });
  }

  async checkForNews() {
    if (!this.db || !this.isNewsApprover()) return;
    this.setState({ newsFetching: true });
    // Live source: ReliefWeb's public API (free, requires a pre-approved
    // appname, CORS-open) — aggregates real situation reports from OCHA,
    // UNHCR, WHO, FEWS NET, NGOs, ReliefWeb itself, etc. Mainstream outlets
    // (BBC/AP/Reuters/CNN/Al Jazeera/Sudan Tribune/Washington Post/Middle
    // East Monitor) don't offer a free, browser-callable API, so those stay
    // in the sample rotation above as a fallback/manual supplement.
    try {
      const url = `https://api.reliefweb.int/v2/reports?appname=${encodeURIComponent(this.RELIEFWEB_APPNAME)}&query[value]=sudan&sort[]=date:desc&limit=20`
        + '&fields[include][]=title&fields[include][]=date.created&fields[include][]=source.name&fields[include][]=url';
      const res = await fetch(url);
      if (!res.ok) throw new Error('bad status ' + res.status);
      const json = await res.json();
      const items = (json.data || []).map(d => {
        const f = d.fields || {};
        return {
          rwId: d.id,
          headline: f.title,
          source: (f.source && f.source[0] && f.source[0].name) || 'ReliefWeb',
          dateISO: f.date && f.date.created,
          url: f.url || ''
        };
      }).filter(it => it.headline && it.rwId);
      if (!items.length) throw new Error('empty response');

      // Dedupe against already-seen (pending, posted, or dismissed) report ids
      const seenSnap = await this.db.ref('sudanNewsSeen').once('value');
      const seen = seenSnap.val() || {};
      const fresh = items.filter(it => !seen[it.rwId]).slice(0, 6);
      if (!fresh.length) {
        this.setState({ newsFetching: false });
        this.flashMsg('No new relief reports since your last check');
        return;
      }

      const updates = {};
      fresh.forEach(it => {
        updates['sudanNews/rw_' + it.rwId] = {
          headline: it.headline,
          source: it.source,
          url: it.url,
          summary: it.dateISO
            ? `Published ${new Date(it.dateISO).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} · live via ReliefWeb`
            : 'Live via ReliefWeb',
          fetchedAt: Date.now(), status: 'pending', live: true
        };
        updates['sudanNewsSeen/' + it.rwId] = true;
      });
      await this.db.ref().update(updates);
      this.setState({ newsFetching: false });
      this.flashMsg(`Fetched ${fresh.length} new relief report${fresh.length > 1 ? 's' : ''} ✓`);
    } catch (e) {
      console.warn('Live ReliefWeb fetch failed, falling back to sample pool', e);
      this.fallbackSampleFetch('Live feed unavailable right now — added a sample update instead');
    }
  }

  approveNews(key, item) {
    if (!this.db) return;
    const text = `📰 ${item.headline}\n${item.summary}\n— ${item.source}`;
    this.db.ref('chat').push({ name: 'Sudan Relief Updates', text, time: `posted by ${this.ME}`, ts: Date.now() });
    this.db.ref('sudanNews/' + key).remove();
    this.flashMsg('Posted to team chat ✓');
  }

  dismissNews(key) {
    if (this.db) this.db.ref('sudanNews/' + key).remove();
    this.flashMsg('Dismissed');
  }

  // In componentDidMount(), alongside the other db.ref(...).on('value', ...) listeners:
  //   this.db.ref('sudanNews').on('value', s => { this.setState({ sudanNews: s.val() || {} }); });

  // In renderVals(), building the list the template consumes:
  renderValsExcerpt() {
    const isNewsViewer = this.isNewsViewer(), isNewsApprover = this.isNewsApprover();
    const sudanNewsList = Object.keys(this.state.sudanNews || {})
      .map(k => ({ key: k, ...this.state.sudanNews[k] }))
      .sort((a, c) => (c.fetchedAt || 0) - (a.fetchedAt || 0))
      .map(item => ({
        key: item.key, headline: item.headline, summary: item.summary, source: item.source,
        url: item.url || '', hasUrl: !!item.url, noUrlFlag: !item.url,
        liveBadge: item.live ? 'Live' : 'Sample',
        liveBadgeStyle: item.live
          ? 'padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;background:#eaf1e7;color:#4f7a53'
          : 'padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;background:#f2ece1;color:#8a7f6f',
        agoLabel: item.fetchedAt ? new Date(item.fetchedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '',
        onApprove: () => this.approveNews(item.key, item), onDismiss: () => this.dismissNews(item.key)
      }));
    return {
      isNewsViewer, isNewsApprover, sudanNewsList, noSudanNews: sudanNewsList.length === 0,
      checkNewsLabel: this.state.newsFetching ? 'Fetching…' : 'Check for updates',
      checkForNews: () => this.checkForNews()
    };
  }
}

/* ---------- Added to the template (inside the Home page, after the
   Plan/Facilities grid) ---------- */

const TEMPLATE_SNIPPET = `
<sc-if value="{{ isNewsViewer }}" hint-placeholder-val="">
  <div style="background:#fffdf9;border-radius:16px;padding:18px 20px;border:1px solid rgba(44,39,33,.06)">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px">
      <div>
        <div style="font:600 15px 'Bricolage Grotesque',sans-serif">Sudan Relief Updates</div>
        <div style="font-size:12px;color:#8a8175;margin-top:2px">Live humanitarian reports (ReliefWeb) + wire updates · awaiting Margaret/Seyfu review before posting to team chat</div>
      </div>
      <sc-if value="{{ isNewsApprover }}" hint-placeholder-val="">
        <div onClick="{{ checkForNews }}" style="padding:8px 14px;border-radius:10px;background:#f2ece1;color:#8a6f4a;font-weight:600;font-size:12.5px;cursor:pointer;white-space:nowrap">{{ checkNewsLabel }}</div>
      </sc-if>
    </div>
    <sc-if value="{{ noSudanNews }}" hint-placeholder-val="">
      <div style="padding:16px 0 6px;color:#a89a83;font-size:13px">No pending updates. <sc-if value="{{ isNewsApprover }}" hint-placeholder-val="">Click "Check for updates" to fetch the latest.</sc-if></div>
    </sc-if>
    <sc-for list="{{ sudanNewsList }}" as="n" hint-placeholder-count="0">
      <div style="display:flex;gap:14px;align-items:flex-start;padding:14px 0;border-top:1px solid rgba(44,39,33,.07)">
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:8px">
            <div style="font-weight:600;line-height:1.3">
              <sc-if value="{{ n.hasUrl }}" hint-placeholder-val="">
                <a href="{{ n.url }}" target="_blank" rel="noopener" style="color:#2c2721;text-decoration:none;border-bottom:1px solid rgba(44,39,33,.25)">{{ n.headline }}</a>
              </sc-if>
              <sc-if value="{{ n.noUrlFlag }}" hint-placeholder-val="{{ true }}">{{ n.headline }}</sc-if>
            </div>
            <div style="{{ n.liveBadgeStyle }}">{{ n.liveBadge }}</div>
          </div>
          <div style="font-size:13px;color:#5a5147;margin-top:3px">{{ n.summary }}</div>
          <div style="font-size:11.5px;color:#8a8175;margin-top:5px">{{ n.source }} · {{ n.agoLabel }} · pending review</div>
        </div>
        <sc-if value="{{ isNewsApprover }}" hint-placeholder-val="">
          <div style="display:flex;flex-direction:column;gap:6px;flex:none">
            <div onClick="{{ n.onApprove }}" style="padding:6px 13px;border-radius:9px;background:#eaf1e7;color:#4f7a53;font-weight:600;font-size:12px;cursor:pointer;text-align:center">Approve &amp; post</div>
            <div onClick="{{ n.onDismiss }}" style="padding:6px 13px;border-radius:9px;background:#f2ece1;color:#8a7f6f;font-weight:600;font-size:12px;cursor:pointer;text-align:center">Dismiss</div>
          </div>
        </sc-if>
      </div>
    </sc-for>
  </div>
</sc-if>
`;
