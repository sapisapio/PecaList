// PecaList — GPL-3.0-or-later. Application-level traffic budgets.
import {performance} from 'node:perf_hooks';
export class Budget {
 constructor(rate,capacity,now=()=>performance.now()){this.rate=rate;this.capacity=capacity;this.now=now;this.tokens=capacity;this.last=now();}
 available(){const now=this.now();this.tokens=Math.min(this.capacity,this.tokens+Math.max(0,now-this.last)*this.rate/1000);this.last=now;return this.tokens;}
 take(amount){if(amount<0||!Number.isFinite(amount)||this.available()<amount)return false;this.tokens-=amount;return true;}
}
