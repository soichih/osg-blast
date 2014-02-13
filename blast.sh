#!/bin/bash

inputquery=$1
dbpath=$2 # /cvmfs/oasis.opensciencegrid.org/osg/projects/IU-GALAXY/blastdb/nr.1-22-2014
dbname=$3 # nr.00

export PATH=$PATH:/cvmfs/oasis.opensciencegrid.org/osg/projects/IU-GALAXY/rhel6/x86_64/ncbi-blast-2.2.28+/bin
export PATH=$PATH:/cvmfs/oasis.opensciencegrid.org/osg/projects/OSG-Staff/rhel6/x86_64/node-v0.10.25-linux-x64/bin

#limit memory at 2G
ulimit -v 2048000

if [ ! -d /cvmfs/oasis.opensciencegrid.org ]; then
    echo "can't access oasis"
    exit 68
fi

echo "listing oasis projects avaialble"
ls -lart /cvmfs/oasis.opensciencegrid.org
ls -lart /cvmfs/oasis.opensciencegrid.org/osg/projects

if [ ! -f $dbpath/$dbname.tar.gz ]; then
    echo "can't find $dbname.tar.gz in oasis"
    exit 68
fi

mkdir blastdb
echo "un-tarring blast db from $dbpath/$dbname"
(cd blastdb && tar -xzf $dbpath/$dbname.tar.gz)
ls -lart blastdb

echo "running blast"
export BLASTDB=blastdb
time blastx -query $inputquery -db $dbname -out output.xml -evalue 0.001 -outfmt 5 `cat $dbpath/blast.opt`
blast_ret=$?

#report return code
case $blast_ret in
0)
    echo "validating output"
    xmllint --noout --stream output.xml
    if [ $? -ne 0 ]; then
        echo "xml is malformed (probably truncated?).."
        exit 11 #produced invalid output
    else
        echo "all good"
        exit 0
    fi
    ;;
1)
    echo "Error in query sequence(s) or BLAST options"
    exit 1
    ;;
2)
    echo "Error in blast database"
    exit 1 #I am not sure which error code to use for this..
    ;;
3)
    echo "Error in blast engine"
    exit 12
    ;;
4)
    echo "out of memory"
    exit 2
    ;;
127)
    echo "no blastp"
    exit 12
    ;;
137)
    echo "probably killed by SIGKILL(128+9).. out of memory / preemption / etc.."
    exit 2
    ;;
*)
    echo "unknown error code: $blast_ret"
    exit 9
    ;;
esac

exit $blast_ret
