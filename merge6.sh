#!/bin/bash

hostname

echo "gunzipping query block $query_block"
time gunzip *.q.$query_block.gz
ls -la 

echo "sorting query block $query_block"
mkdir $outdir
time sort *.q.$query_block | gzip -c > $outdir/merged.q.$query_block.gz
if [ $? -ne 0 ]; then
    echo "failed to sort"
    exit 1
fi

echo "sorted successfully"
ls -la $outdir/merged.q.$query_block.gz
