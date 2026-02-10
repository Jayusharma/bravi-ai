import { getAuthToken } from "./Auth";

const Api_Url = (process.env.NEST_API_URL || '').trim();

export async function serverFetch(
    path: string,
    options: RequestInit = {},
) {

    
    //here we are reading the token sent from browser to next js server ...
    const token = await getAuthToken();

    

    //now we want to attach the header which is authorization header bearer <token >
    const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
    }


    //now we had extracted token and attached to headers now we have to send the request to nest js server 
    const res = await fetch(`${Api_Url}${path}`, {
        ...options,
        headers,
        cache: 'no-store'
    })

   

    if (res.status === 401) {
        throw new Error('UNAUTHORIZED');
    }

    if (!res.ok) {
        throw new Error(await res.text());
    }

    return res.json();

}