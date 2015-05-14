## OSG Blast (V2)

ncbi-blast workflow submission script

osg-blast submits a workflow to run blast search on a large input queries against a large blast database. 
osg-blast is intended to run on Open Science Grid, and on a glidein enabled submit host (such as xd-login.opensciencegrid.org or login.osgconnect.net).

# Installing blast from ncbi

First you need to download the latest blast executable from
ftp://ftp.ncbi.nlm.nih.gov/blast/executables/blast+/LATEST/ncbi-blast-2.2.30+-x64-linux.tar.gz
Be sure to add /bin directory to your PATH

# Installing osg-blast

osg-blast (this repo!) allows you to run blast jobs on DHTC environment.

If you don't have npm installed, please install it via yum.

> sudo yum install npm

If you don't have sudo access, you can download & install nodejs on your home directory from http://nodejs.org/. Make sure to add path to nodejs's bin directory if you install locally.


Install osg-blast on your home directory

> cd ~
> npm install osg-blast

Add -g if you want to install it under /usr/bin (you need sudo access)

> npm install osg-blast -g

If you install osg-blast on your home directory, add a path to osg-blast on your ~/.bashrc

> export PATH=$PATH:~/node_modules/osg-blast/bin

# Updating osg-blast

To update osg-blast installation..

> cd ~
> npm update osg-blast

# Running osg-blast

Step 1. Place some fasta input query inside an empty directory.

Or you can use following example.. (input.fasta)

```
>comp7_c0_seq1 len=222 path=[382:0-221]
CCACTCGGAAATCTCATCTGAGAACACCGACAACCGGACCATTCGTGCGACGGCGGAGTA
CAAGCCCGGCTCGGGCCTGCACTACTTTGAAGTCGAATCCCGCTGCCCCAAGGAGGTGCA
ATACCACCCGTACGTCGGTCTGTGCTCCACCAATGAGGCCGTGCCGGTGGAGAAGATGCT
GATGTGGCTCAGCGATCTGTGCTACGCCTACGGCGGGGAAGG
>comp55_c0_seq1 len=228 path=[206:0-227]
GCCGCGTATTCTCGTAGCATGTCCGGGGTGGGCTGGGTCTGCGCTCCATTCATCACCGCC
ACTTGGGGGAGACCATGCTCCTTCAGATCGCGCTCCAAGGCGTCCATCGCCCCCATACCT
TTAGTATGGTTCCCCGAATAGATGACTAAGAACTTACATCCCGCGAGTTGACGATACAGA
CGGCTCCACGGCTGATCGAGCGGTTTGAGCTTCTCCAGCCAGCCCATA
>comp129_c0_seq1 len=214 path=[317:0-213]
GAGGGAACTCTTGGTTGCTCTGAATGACCAGTATGCTGAGGTAGTTGTCCAGGGTGTACT
TGTGAAACTCTTGGATCCACTGGTCTATCAGCGTGGCGGGAACCACTATCAATGTCGCCG
CGGAAAGATACATTTGCATCGCCAGAGGGAGGCCCTTCCGAGGCGTGCCATCGCCAGAGG
TGCCACGGGCTTGGGCGGCACTTTCCGAAGAACT

```

Step 2. Create config.json containing something like following (in the same director where you put input.fasta)

```
{
    "project": "IU-GALAXY",
    "user": "hayashis",
    "input": "input.fasta",
    "db": "oasis:nt.2015-04-27",
    "blast": "blastn",
    "blast_opts": "-evalue 0.001 -outfmt 6 -best_hit_score_edge 0.05 -best_hit_overhang 0.25 -perc_identity 98.0"
}
```

You need to use the project name that you have access on your submit host (instead of IU-GALAXY). "user" should usually match your local uid - it's just
used to tell xd-login to not wait on other user's jobs if submitted from IU GALAXY. "db" is the name of blast DB that you'd like to search against (Please see under /cvmfs/oasis.opensciencegrid.org/osg/projects/IU-GALAXY/blastdb for currently available databases. Or you can see http://xd-login.opensciencegrid.org/scratch/iugalaxy/blastdb/dblist.json)

(See below for a bit more info on hosted DB)

Step 3. Run osg-blast-test

This application samples your input query, and submit a small test jobs to figure out the optimal number of query sizes to run for each jobs.

> osg-blast-test --config config.json --out stats.json

Step 4.  Split your input query using stats.json 

> mkdir input
> osg-blast-split --config config.json --stats stats.json --out input

Step 5.  Generate blast.dag and blast.condor file to submit your workflow

> osg-blast-gendag --config config.json --stats stats.json

Step 6. Finally, submit the dag file to run your workflow!

> mkdir log
> mkdir output
> condor_dag_submit blast.dag

Step 7. Wait for the dag to complete

This is mainly for cases where you are running osg-blast from Galaxy, or other wrapper systems that needs to "wait" until the job is complete (it could take
days!)

> condor_wait blast.dag.dagman.log

Step 8. Merge outputs

Once osg-blast finishes, you are left with hundreds of output files. For outputs from the same query, you will need to sort
the result by e-value, and merge them into a single file. For csv output, you can simply use sort command. For XML output, 
it's a bit more complicated. osg-blast-merge9 script in /bin does this for you, but I haven't ported it to run on osg-blast v3 
(stay tuned!)

osg-blast-gendag creates another condor submit file (blast.merge6.condor) which runs the csv output file sorting / merging
process using the submit host's local job slot. This hasn't been tested outside of xd-login.opensciencegrid.org, so I won't 
document here (yet), but please feel free to take a look.


# Hosted Databases

osg-blast uses some hosted DB (such as those DB published by NCBI) so you don't have to have them available with 
your job. osg-blast will use ones published via OSG's OASIS.

You can see a list of OASIS hosted blast databases here
> http://xd-login.opensciencegrid.org/scratch/iugalaxy/blastdb/dblist.json

Anyone can use these databases. GOC periodically updates the content of the DB from the NCBI website. You can also provide your own database to run your job (contact hayashis@iu.edu for more info).

If you want to provide your own database, you can do so, but you need to make it available via some webserver (or any CDN) where
each job can download the database part from. Most submit host (xd-login, osg-connect, etc... ) provides you some mechanism to 
publish your input database for you. Please contact your submit host administrator.

# Updating Blast DB on OASIS

OSG Operations group normally update the OASIS DB. Here is the instruction on how to update the OASIS DB for operations staff.

1. Become an OSG VO OASIS Manager (https://oim.grid.iu.edu/oim/vo?id=30)
2. gsissh to oasis-login as OSG user.

  > voms-proxy-init -voms osg
  > gsissh ouser.osg@oasis-login.grid.iu.edu
  
3. Navigate to IU-GALAXY/blastdb directory

  > cd /home/ouser.osg/cvmfs/projects/IU-GALAXY/blastdb

4. Run download script. 

  > ./download_all.sh
 This will start downloading various blast DB from various places under directory named after today's date. The entire download process may take up to an hour.
 
5. Validate & update dblist.json
  Make sure all download was successful (blast DB contained in each new directories), and update dblist.json (edit it via vim / emacs, etc..) - normally just update the dates on each DB types.

6. Publish oasis

  > osg-oasis-update
 Update process make take a while, and it will take another day or so until most OSG sites will have the updated OASIS content.

7. Submit test job

  Once the new content propagates to most OSG sites, submit a test blast job using the new DB.

# Updating Blast DB on irods

osg-blast can run on irods hosted DB as well as OASIS. Use of irods is experimental, so please contact hayashis@iu.edu if you need the irods DB updated.



