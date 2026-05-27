import qs from 'querystring';

export async function loginWiki() {
    try {
        console.log('1. Init SSO');
        const r1 = await fetch('https://wikicv.net/auth/dth', {
            headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://wikicv.net/' }, redirect: 'manual'
        });
        const redirectUrl = r1.headers.get('location');
        if (!redirectUrl) throw new Error('No redirectUrl ' + r1.status);

        console.log('2. Get Forum Login Page');
        const r2 = await fetch(redirectUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' }, redirect: 'manual'
        });
        const r2html = await r2.text();
        const csrfToken = r2html.match(/name="_csrf" value="(.*?)"/)?.[1];
        
        let forumCookieStr = '';
        if (r2.headers.get('set-cookie')) {
            forumCookieStr = r2.headers.get('set-cookie')?.split(',').map(s => s.split(';')[0].trim()).join('; ') || '';
        }

        console.log('3. Post Forum Login');
        const r3 = await fetch('https://forum.dichtienghoa.com/login', {
            method: 'POST',
            body: qs.stringify({
                username: 'vipllpro',
                password: 'bacnam123',
                _csrf: csrfToken,
                remember: 'on',
                noscript: 'false'
            }),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Cookie': forumCookieStr,
                'User-Agent': 'Mozilla/5.0',
                'Referer': redirectUrl,
                'x-csrf-token': csrfToken || ''
            },
            redirect: 'manual'
        });
        
        if (r3.headers.get('set-cookie')) {
            forumCookieStr += '; ' + r3.headers.get('set-cookie')?.split(',').map(s => s.split(';')[0].trim()).join('; ');
        }

        console.log('4. Follow redirect back (SSO auth)');
        const r4 = await fetch(redirectUrl, {
            headers: { 'Cookie': forumCookieStr, 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://forum.dichtienghoa.com/login' }, redirect: 'manual'
        });
        const ssoUrlReturn = r4.headers.get('location');
        if (!ssoUrlReturn) throw new Error('No sso return ' + r4.status);

        console.log('5. Hit Wiki callback', ssoUrlReturn);
        const r5 = await fetch(ssoUrlReturn, {
            headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://forum.dichtienghoa.com/' }, redirect: 'manual'
        });
        
        let wikiCookieStr = '';
        if (r5.headers.get('set-cookie')) {
            wikiCookieStr = r5.headers.get('set-cookie')?.split(',').map(s => s.split(';')[0].trim()).join('; ') || '';
        }
        
        console.log('Wiki Cookie:', wikiCookieStr);
        return wikiCookieStr;
    } catch(e) {
        console.error('Failed to login:', e.message);
    }
}

loginWiki().then(c => console.log('Final cookie:', c));
