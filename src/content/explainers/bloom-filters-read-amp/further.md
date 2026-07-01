# Further — bloom-filters-read-amp parking lot

Material deliberately cut to keep #12 answering one question (how a bloom filter trades memory
for false positives, and why that decides LSM read amplification).

## Counting bloom filters & deletion
A plain bloom filter can't delete — clearing a bit shared with another key creates a false
negative. Counting filters replace bits with small counters; their own explainer.

## Cuckoo & ribbon filters
Cuckoo filters support deletion and lookups with better cache locality; ribbon filters (RocksDB
6.15+) cut memory ~30% at similar FPR for more CPU. The space/CPU/FPR surface is its own piece.

## Blocked bloom filters
Packing each key's k bits into one cache line trades a slightly worse FPR for one cache miss
per query instead of k. A "filters and the memory hierarchy" explainer.

## Prefix filters & range queries
Bloom filters answer point lookups only. RocksDB prefix filters approximate range pruning by
filtering on a key prefix; the trade-offs deserve their own treatment.
