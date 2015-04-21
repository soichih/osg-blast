## OSG Blast (V2)

ncbi-blast workflow submission script

osg-blast submits a workflow to run blast search on a large input queries against a large blast database. 
osg-blast is intended to run on Open Science Grid, and on a glidein enabled submit host (such as osg-xsede or OSGconnect).

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
    "db": "oasis:nt.1-22-2014",
    "blast": "blastn",
    "blast_opts": "-evalue 0.001 -outfmt 6 -best_hit_score_edge 0.05 -best_hit_overhang 0.25 -perc_identity 98.0"
}
```

You need to use the project name that you have access on your submit host. "user" should usually match the local uid. "db" is the name of blast DB that you'd like to search against.  Please see under /cvmfs/oasis.opensciencegrid.org/osg/projects/IU-GALAXY/blastdb for currently available databases. Or you can see http://xd-login.opensciencegrid.org/scratch/iugalaxy/dblist.json

* You need to update the project that you have access on your submit host! (IU-GALAXY for an example..)

Step 3. Run osg-blast 

Run osg-blast command on the directory where you have config.json

> osg-blast

If you want your job to run after you log off from terminal, make sure to use nohup command.

> nohup osg-blast > stdout.txt 2> stderr.txt &
> tail -f stdout.txt stderr.txt

To abort your job, simply hit CTRL+C (or kill osg-blast process which will terminate all jobs submitted)

osg-blast will first run submit some test jobs in order to collect some runtime information, then split the input queries and database (if user provided) into appropriate sizes, then start submitting jobs (there could be many thousands, depending on the size of your database, and input query, and your input parameters).


When your job completes, it will output something like following

```
RUNNING :: Tue Apr 21 2015 12:31:37 GMT+0000 (UTC) :: 211311.0 successfully completed in 248390ms :: finished:17/17
COMPLETED :: Tue Apr 21 2015 12:31:37 GMT+0000 (UTC) :: all jobs successfully completed. total jobs:17
COMPLETED :: Tue Apr 21 2015 12:31:37 GMT+0000 (UTC) :: Workflow statistics:
---------------------------------------------------------------------------
Workflow Statistics
---------------------------------------------------------------------------
MIT_CMS avg walltime per job(ms):69585
success:4

Tusker avg walltime per job(ms):187742
success:11

Purdue-Hadoop avg walltime per job(ms):81216
success:1

UCSDT2 avg walltime per job(ms):91098
success:2

---------------------------------------------------------------------------
Total Walltime(ms) of workflow:342450
Total Jobs:18
---------------------------------------------------------------------------

workflow completed successfully

```

Step 4. Merge output

osg-blast will generate output files for each jobs under ./output directory. You can use osg-blast's merge script to merge all of your output into a single output file.

```
$ cd output
$ osg-blast-merge6
merging dbparts
merging query block 0
output.qb_0.db_0   output.qb_0.db_11  output.qb_0.db_14  output.qb_0.db_2  output.qb_0.db_5  output.qb_0.db_8
output.qb_0.db_1   output.qb_0.db_12  output.qb_0.db_15  output.qb_0.db_3  output.qb_0.db_6  output.qb_0.db_9
output.qb_0.db_10  output.qb_0.db_13  output.qb_0.db_16  output.qb_0.db_4  output.qb_0.db_7
merging query blocks
```

osg-blast-merge6 is to merge outputs in tabular format (-outfmt 6). For XML output  (-outfmt 5), use osg-blast-merge5. XML mering requires substantial amount of memory (if you are merging 100s of GB of data), so please don't merge them on your submit host.

Following is the output from the sample input file above

```
[hayashis@login01 output]$ cat merged
comp129_c0_seq1 gi|470487826|ref|XM_004344685.1|        98.44   128     2       0       1       128     128     1       7e-56     226
```

It looks like there was only 1 match for the 3rd input sequence "comp129_c0_seq1". (TODO I need to make the sample input more interesting..sorry!)

# Details

osg-blast splits your input queries, and use DB that is split into mutiple chunks (1G compressed each), and submits
all jobs on local queue in the order of required DB part number (to maximize squid hits). Any failed job will be
analyzed to see if it can be re-submitted elsewhere, and if not, then abort the entire workflow.

Every blast execution is unique, and amount of memory / cpu resources required to run blast depends on the type
of input query, db, and input parameters, etc.. so osg-blast first submits some test jobs in order to determine 
how large the each input block should be. 

osg-blast uses some hosted DB (such as those DB published by NCBI) so you don't have to have them available with 
your job. osg-blast will use ones published via OSG's OASIS.

If you want to provide your own database, you can do so, but you need to make it available via some webserver where
each job can download from (through squid). Most submit host (xd-login, osg-connect, etc... ) provides you some mechanism to 
publish your input database for you. Please contact your submit host administrator.

# Hosted Databases

You can see a list of OASIS hosted blast databases here
> http://xd-login.opensciencegrid.org/scratch/iugalaxy/dblist.json

Anyone can use these databases. GOC periodically updates the content of the DB from the NCBI website. You can also provide your own database to run your job (contact hayashis@iu.edu for more info).

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



