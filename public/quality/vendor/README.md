# Pinned upstream quality-check scripts

These are **unmodified, byte-for-byte** source copies of the following projects,
served from the same CFSM host as the diagnostic collector. They permit
installation from VPS networks that cannot reach GitHub directly.

| File | Project | Pinned Git commit | Git blob SHA-1 |
| --- | --- | --- | --- |
| `ip.sh` | [xykt/IPQuality](https://github.com/xykt/IPQuality) | `8e685686e1df89119d9aeb182a9dedbc88da19e3` | `4dad5782d4095ed214b821951eba39353b5e0da4` |
| `net.sh` | [xykt/NetQuality](https://github.com/xykt/NetQuality) | `e91cd4963c2676da0e12bcece8ccb145e04a6735` | `3f53747f00e6a00fe39534280a1c1dc6b71abbad` |

The scripts are distributed under the **GNU Affero General Public License
v3.0**, copied verbatim to [LICENSE](./LICENSE). Upstream attribution,
license headers, and source code remain intact. Any compatibility changes
for domestic VPS connections are applied at runtime to disposable copies
by `collector.py`; they are not written to the original sources.

CFSM's installer verifies each downloaded script's pinned Git blob ID
before installation and does not silently upgrade to a newer upstream version.
