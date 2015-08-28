#!/bin/bash

###################################################################################################
#
# This script gets executed on each osg site to run blast
#

echo $OSG_SITE_NAME $OSG_HOSTNAME
env | sort

if [ $oasis_dbpath ]; then
    echo "using oasis db"

    #blast app and irod binary comes from oasis. we need oasis
    if [ ! -d /cvmfs/oasis.opensciencegrid.org ]; then
        env | sort
        echo "can't access /cvmfs/oasis.opensciencegrid.org"
        exit 68
    fi

    echo "listing $oasis_dbpath"
    ls -lart $oasis_dbpath

    if [ ! -f $oasis_dbpath/$dbname.tar.gz ]; then
        echo "can access oasis, but can't find $oasis_dbpath/$dbname.tar.gz - probably wrong dbname?"
        exit 3
    fi

    #create subdirectory so that condor won't try to ship it back to submit host accidentally
    mkdir blastdb
    date +%c
    echo "un-tarring blast db from $oasis_dbpath/$dbname.tar.gz to ./blastdb/"
    time (cd blastdb && tar -xzf $oasis_dbpath/$dbname.tar.gz)
    echo "done"
    date +%c

    if [ $? -ne 0 ]; then 
        echo "failed to untar $oasis_dbpath/$dbname.tar.gz - let's retry.."
        exit 16
    fi

elif [ $irod_dbpath ]; then
    echo "using irod db"

    #blast app and irod binary comes from oasis. we need oasis
    if [ ! -d /cvmfs/oasis.opensciencegrid.org ]; then
        env | sort
        echo "can't access /cvmfs/oasis.opensciencegrid.org"
        exit 68
    fi

    #create subdirectory so that condor won't try to ship it back to submit host accidentally
    mkdir blastdb
    date +%c
    echo "copying $dbname.tar.gz from $irod_dbpath"
    
    /cvmfs/oasis.opensciencegrid.org/osg/projects/iRODS/noarch/client/v0.8/icp-osg $irod_dbpath/$dbname.tar.gz blastdb/$dbname.tar.gz 

    ret=$?
    if [ $ret -ne 0 ]
    then
        echo "failed to download blast db part via irods (retcode:$ret)"
        exit 3
    else
        date +%c
        echo "untarring blastdb"
        (cd blastdb && tar -xzf $dbname.tar.gz)

        if [ $? -ne 0 ]; then 
            echo "failed to untar $dbname.tar.gz - let's retry.."
            exit 17
        fi
    fi 
else
    #user db doesn't use OASIS!
    echo "downloading user db from $user_dbpath - through squid";

    #need to deal with squid server.. https://twiki.grid.iu.edu/bin/view/Documentation/OsgHttpBasics
    export OSG_SQUID_LOCATION=${OSG_SQUID_LOCATION:-UNAVAILABLE}
    if [ "$OSG_SQUID_LOCATION" != UNAVAILABLE ]; then
        echo "using squid:" $OSG_SQUID_LOCATION
        export http_proxy=$OSG_SQUID_LOCATION

        #test squid access (per goc ticket 22099, switching to use cern.ch)
        wget -q --timeout=2 http://cern.ch
        if [ $? -ne 0 ]; then
            echo "wget failed through squid.. $OSG_SQUID_LOCATION.. trying without squid"
            #exit 15
            unset http_proxy
        fi
    else
        echo "OSG_SQUID_LOCATION is not set... not using squid"
    fi

    echo "downloading user db from $user_dbpath/$dbname.tar.gz"
    time wget -q --timeout=30 $user_dbpath/$dbname.tar.gz
    if [ $? -ne 0 ]; then 
        echo "failed to download $user_dbpath/$dbname.tar.gz"
        exit 18
    fi

    #create subdirectory so that condor won't try to ship it back to submit host accidentally
    mkdir blastdb
    (cd blastdb && tar -xzf ../$dbname.tar.gz)
fi

ls -lart blastdb

#echo "head of $inputquery"
#head -20 $inputquery

#-outfmt 5 : xml
#-outfmt 6 : tabular
#-outfmt 7 : tabular (with comments)
#-outfmt 10 : csv
#-outfmt 11 : asn.1

export BLASTDB=blastdb
mkdir $outdir

#$blast_opts could contains multiple token, and some token might be quoted.
#the only way to make bash not clobber this is to write out to another file and executing the file...
echo -n "./$blast -query $inputquery -db $dbname -out $outdir/$outputname $blast_opts" > cmd.sh
if [ $dbsize ]; then
    echo -n " -dbsize $dbsize" >> cmd.sh
fi

cat cmd.sh
chmod +x cmd.sh
time ./cmd.sh
blast_ret=$?

echo "blast returned code: $blast_ret"
ls -lart
ls -lart output

case $blast_ret in
0)
    echo "zipping output"
    gzip $outdir/$outputname

    #echo "validating output"
    #xmllint --noout --stream output
    #if [ $? -ne 0 ]; then
    #    echo "xml is malformed (probably truncated?).."
    #    exit 11 #produced invalid output
    #else
    #    echo "all good"
    #    exit 0
    #fi
    #exit 0
    ;;
1)
    echo "Error in query sequence(s) or BLAST options"
    #exit 1 #input error
    ;;
2)
    echo "Error in blast database"
    #exit 1 #input error
    ;;
3)
    echo "Error in blast engine"
    #exit 12
    ;;
4)
    echo "out of memory"
    #exit 2
    ;;
126)
    echo "blast binary can't be executed"
    #exit $blast_ret
    ;;
127)
    echo "no blast binary"
    #exit $blast_ret
    ;;
128)
    #I don't know what this is 
    echo "invalid argument to exit"
    #exit $blast_ret
    ;;
135)
    echo "probably killed by SIGEMT (128+7).. probably terminated with a core dump."
    #exit $blast_ret
    ;;
137)
    echo "probably killed by SIGKILL(128+9).. out of memory / preemption / etc.."
    #exit $blast_ret
    ;;
139)
    echo "blast segfaulted"
    #exit $blast_ret
    ;;
143)
    echo "probably killed by SIGTERM(128+14).."
    #exit $blast_ret
    ;;
255)
    echo "NCBI C++ Exception?"
    #exit 13
    ;;
*)
    echo "unknown error code: $blast_ret"
    #exit $blast_ret
    ;;
esac

exit $blast_ret

#http://unixhelp.ed.ac.uk/CGI/man-cgi?signal+7
#       Signal     Value     Action   Comment
#       -------------------------------------------------------------------------
#       SIGHUP        1       Term    Hangup detected on controlling terminal
#                     or death of controlling process
#       SIGINT        2       Term    Interrupt from keyboard
#       SIGQUIT       3       Core    Quit from keyboard
#       SIGILL        4       Core    Illegal Instruction
#       SIGABRT       6       Core    Abort signal from abort(3)
#       SIGFPE        8       Core    Floating point exception
#       SIGKILL       9       Term    Kill signal
#       SIGSEGV      11       Core    Invalid memory reference
#       SIGPIPE      13       Term    Broken pipe: write to pipe with no readers
#       SIGALRM      14       Term    Timer signal from alarm(2)
#       SIGTERM      15       Term    Termination signal
#       SIGUSR1   30,10,16    Term    User-defined signal 1
#       SIGUSR2   31,12,17    Term    User-defined signal 2
#       SIGCHLD   20,17,18    Ign     Child stopped or terminated
#       SIGCONT   19,18,25    Cont    Continue if stopped
#       SIGSTOP   17,19,23    Stop    Stop process
#       SIGTSTP   18,20,24    Stop    Stop typed at tty
#       SIGTTIN   21,21,26    Stop    tty input for background process
#       SIGTTOU   22,22,27    Stop    tty output for background process

