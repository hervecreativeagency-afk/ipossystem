import React from 'react';
import {Link} from 'react-router-dom';
export default function Brand({className=''}){return <Link to="/" className={'brand '+className} aria-label="iPOS home"><span className="brand-icon"><img src="/ipos-logo.png?v=63d57fe26bca" alt=""/></span><span>iPOS</span></Link>}
